import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { buildPrompt, titleFor } from './prompts.mjs';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const s3Client = new S3Client({});

const TABLE_NAME = process.env.TABLE_NAME;
const MATERIALS_BUCKET = process.env.MATERIALS_BUCKET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const AI_MODE = (process.env.AI_MODE || 'openai').toLowerCase();
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const STORAGE_MODE = (process.env.STORAGE_MODE || '').toLowerCase()
  || ((process.env.AWS_SAM_LOCAL === 'true' || process.env.LOCAL_DEV === 'true') ? 'local' : 's3');
const USE_LOCAL_STORAGE = STORAGE_MODE === 'local';
const USE_LOCAL_HISTORY = STORAGE_MODE === 'local' || !process.env.TABLE_NAME;
const LOCAL_STORAGE_DIR = process.env.LOCAL_STORAGE_DIR || '/tmp/cloudmentor-materials';
const LOCAL_HISTORY_FILE = process.env.LOCAL_HISTORY_FILE || '/tmp/cloudmentor-history.json';
const DEMO_USER_ID = 'demo-user';
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 12000;

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': CORS_ORIGIN,
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,x-amz-date,x-amz-security-token,x-amz-content-sha256',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS'
};

export async function handler(event) {
  try {
    const method = event.requestContext?.http?.method || event.httpMethod || 'GET';
    const pathName = normalizePath(event.rawPath || event.path || '/');

    if (method === 'OPTIONS') {
      return response(204, {});
    }

    if (method === 'GET' && pathName === '/health') {
      return response(200, {
        ok: true,
        service: 'CloudMentor API',
        runtime: 'nodejs22.x',
        storageMode: USE_LOCAL_STORAGE ? 'local-filesystem' : 's3',
        aiMode: AI_MODE,
        openAiKeyConfigured: Boolean(OPENAI_API_KEY) && !isPlaceholderOpenAIKey(OPENAI_API_KEY),
        bucketConfigured: Boolean(MATERIALS_BUCKET),
        timestamp: new Date().toISOString()
      });
    }

    if (method === 'GET' && pathName === '/history') {
      const limit = Number(event.queryStringParameters?.limit || 12);
      const items = await getHistory(Number.isFinite(limit) ? Math.min(limit, 50) : 12);
      return response(200, { items });
    }

    if (method === 'PUT' && pathName.startsWith('/local-upload/')) {
      return await handleLocalFileUpload(event, pathName);
    }

    if (method === 'POST') {
      const body = parseJson(event.body);

      if (pathName === '/upload-url') {
        return await createUploadUrl(body, event);
      }

      if (pathName === '/process-file') {
        return await processUploadedFile(body);
      }

      if (pathName === '/summarize') {
        return await handleAiAction('summarize', body);
      }

      if (pathName === '/quiz') {
        return await handleAiAction('quiz', body);
      }

      if (pathName === '/flashcards') {
        return await handleAiAction('flashcards', body);
      }

      if (pathName === '/study-plan') {
        return await handleAiAction('studyPlan', body);
      }

      if (pathName === '/save-progress') {
        return await saveProgress(body);
      }
    }

    return response(404, {
      error: 'Route not found',
      method,
      path: pathName
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) {
      console.error('Unhandled API error', error);
    }

    return response(statusCode, {
      error: statusCode >= 500 ? 'Internal server error' : error.message,
      message: error.message
    });
  }
}

async function createUploadUrl(payload) {
  const originalName = sanitizeFileName(payload.fileName || 'cloudmentor-notes.txt');
  const contentType = sanitizeContentType(payload.contentType || 'application/octet-stream');
  const size = Number(payload.size || 0);

  if (size && size > MAX_UPLOAD_BYTES) {
    throw new HttpError(400, 'File is too large for this classroom demo. Keep uploads under 2 MB.');
  }

  const key = buildObjectKey(originalName);

  if (USE_LOCAL_STORAGE) {
    return response(200, {
      mode: 'local',
      key,
      bucket: 'local-filesystem',
      uploadUrl: `/local-upload/${encodeURIComponent(key)}`,
      expiresInSeconds: 900,
      note: 'SAM local mode stores files in the Lambda local filesystem instead of S3.'
    });
  }

  if (!MATERIALS_BUCKET) {
    throw new HttpError(500, 'MATERIALS_BUCKET is not configured. Deploy the SAM stack with the S3 bucket resource.');
  }

  const command = new PutObjectCommand({
    Bucket: MATERIALS_BUCKET,
    Key: key,
    ContentType: contentType
  });

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });

  return response(200, {
    mode: 's3',
    key,
    bucket: MATERIALS_BUCKET,
    uploadUrl,
    expiresInSeconds: 900
  });
}

async function handleLocalFileUpload(event, pathName) {
  if (!USE_LOCAL_STORAGE) {
    throw new HttpError(403, 'Local upload endpoint is only available when STORAGE_MODE=local.');
  }

  const encodedKey = pathName.slice('/local-upload/'.length);
  const key = decodeURIComponent(encodedKey);
  validateObjectKey(key);

  const buffer = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64')
    : Buffer.from(event.body || '', 'utf8');

  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new HttpError(400, 'File is too large for this classroom demo. Keep uploads under 2 MB.');
  }

  const filePath = safeLocalPath(key);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer);

  const localBaseName = path.basename(key);
  const originalName = localBaseName.includes('__') ? localBaseName.split('__').slice(2).join('__') : localBaseName;
  const contentType = sanitizeContentType(event.headers?.['content-type'] || event.headers?.['Content-Type'] || 'application/octet-stream');
  const processed = await buildProcessedFileResponse({ key, originalName, contentType, buffer, storageMode: 'local-filesystem' });

  await saveHistory({
    type: 'upload',
    title: `Upload: ${originalName}`,
    request: { key, originalName, contentType, storageMode: 'local-filesystem' },
    result: processed.textSupported
      ? `File uploaded locally and ${processed.extractedText.length} characters were extracted.`
      : processed.message
  });

  return response(200, processed);
}

async function processUploadedFile(payload) {
  const key = String(payload.key || '').trim();
  const originalName = sanitizeFileName(payload.originalName || payload.fileName || path.basename(key));
  const contentType = sanitizeContentType(payload.contentType || 'application/octet-stream');

  validateObjectKey(key);

  let buffer;
  let storageMode;

  if (USE_LOCAL_STORAGE) {
    const filePath = safeLocalPath(key);
    buffer = await fs.readFile(filePath).catch(() => {
      throw new HttpError(404, 'Local file was not found. Upload it again, then process it.');
    });
    storageMode = 'local-filesystem';
  } else {
    if (!MATERIALS_BUCKET) {
      throw new HttpError(500, 'MATERIALS_BUCKET is not configured.');
    }
    const object = await s3Client.send(new GetObjectCommand({
      Bucket: MATERIALS_BUCKET,
      Key: key
    }));
    buffer = await streamToBuffer(object.Body);
    storageMode = 's3';
  }

  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new HttpError(400, 'File is too large for AI extraction in this classroom demo. Keep uploads under 2 MB.');
  }

  const processed = await buildProcessedFileResponse({ key, originalName, contentType, buffer, storageMode });

  await saveHistory({
    type: 'upload',
    title: `Upload: ${originalName}`,
    request: { key, originalName, contentType, storageMode },
    result: processed.textSupported
      ? `File stored in ${storageMode} and ${processed.extractedText.length} characters were extracted.`
      : processed.message
  });

  return response(200, processed);
}

async function buildProcessedFileResponse({ key, originalName, contentType, buffer, storageMode }) {
  const extraction = extractTextFromFile(buffer, originalName, contentType);

  if (!extraction.supported) {
    return {
      uploaded: true,
      key,
      originalName,
      sizeBytes: buffer.length,
      contentType,
      storageMode,
      textSupported: false,
      extractedText: '',
      message: 'File uploaded and stored. CloudMentor can auto-load text-based files only: .txt, .md, .csv, .json, .yaml, .yml, and .log. For PDF/DOCX, store the file here and paste the important text into the notes box.'
    };
  }

  return {
    uploaded: true,
    key,
    originalName,
    sizeBytes: buffer.length,
    contentType,
    storageMode,
    textSupported: true,
    extractedText: extraction.text,
    message: 'File uploaded and text was loaded into the CloudMentor workspace.'
  };
}

function extractTextFromFile(buffer, originalName, contentType) {
  const extension = path.extname(originalName || '').toLowerCase();
  const textLikeContentType = /^(text\/|application\/(json|x-ndjson|yaml|x-yaml|xml))/.test(contentType || '');
  const textLikeExtension = ['.txt', '.md', '.markdown', '.csv', '.json', '.yaml', '.yml', '.log'].includes(extension);

  if (!textLikeContentType && !textLikeExtension) {
    return { supported: false, text: '' };
  }

  const text = buffer
    .toString('utf8')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, ' ')
    .trim();

  if (!text) {
    return { supported: false, text: '' };
  }

  return {
    supported: true,
    text: text.length > MAX_EXTRACTED_CHARS
      ? `${text.slice(0, MAX_EXTRACTED_CHARS)}\n\n[CloudMentor note: file text was truncated to ${MAX_EXTRACTED_CHARS} characters for this demo.]`
      : text
  };
}

async function handleAiAction(action, payload) {
  validatePayload(action, payload);

  const prompt = buildPrompt(action, payload);
  const aiOutput = AI_MODE === 'mock'
    ? buildMockAiOutput(action, payload)
    : buildOpenAiOutput(action, await callOpenAI(prompt), payload);

  const item = await saveHistory({
    type: action,
    title: titleFor(action, payload),
    request: safeRequest(payload),
    result: aiOutput.result,
    resultData: aiOutput.resultData
  });

  return response(200, {
    id: item.id,
    type: action,
    title: item.title,
    result: aiOutput.result,
    resultData: aiOutput.resultData,
    createdAt: item.createdAt
  });
}

async function callOpenAI(prompt) {
  if (isPlaceholderOpenAIKey(OPENAI_API_KEY)) {
    throw new HttpError(400, 'OPENAI_API_KEY is missing or still uses a placeholder value. For free local classroom testing, set AI_MODE=mock in backend/env.json. For real AI output, add a valid OpenAI API key.');
  }

  const apiResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: 'system',
          content: 'You are CloudMentor, a concise, helpful, classroom-safe AI tutor. Return clear Markdown.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_output_tokens: 3000
    })
  });

  const data = await apiResponse.json().catch(() => ({}));

  if (!apiResponse.ok) {
    console.error('OpenAI API error', data);
    const message = data.error?.message || `OpenAI request failed with status ${apiResponse.status}`;
    throw new Error(message);
  }

  return extractOpenAiText(data);
}


function buildOpenAiOutput(action, aiText, payload) {
  const structuredActions = new Set(['quiz', 'flashcards', 'studyPlan']);

  if (!structuredActions.has(action)) {
    return { result: aiText, resultData: null };
  }

  const parsed = parseAiJson(aiText);
  if (parsed) {
    const normalized = normalizeStructuredData(action, parsed, payload);
    return {
      result: stringifyStructuredResult(action, normalized),
      resultData: normalized
    };
  }

  return {
    result: aiText,
    resultData: null
  };
}

function buildMockAiOutput(action, payload) {
  const source = String(payload.notes || payload.topic || 'CloudMentor topic').trim();
  const topic = extractTopic(source);

  if (action === 'quiz') {
    const resultData = buildMockQuiz(topic);
    return {
      result: stringifyStructuredResult(action, resultData),
      resultData
    };
  }

  if (action === 'flashcards') {
    const resultData = buildMockFlashcards(topic);
    return {
      result: stringifyStructuredResult(action, resultData),
      resultData
    };
  }

  if (action === 'studyPlan') {
    const resultData = buildMockStudyPlan(topic, payload);
    return {
      result: stringifyStructuredResult(action, resultData),
      resultData
    };
  }

  return {
    result: `## Mock Summary\n\nCloudMentor is running in **mock AI mode**, so no OpenAI API call was made.\n\n### Short summary\nThis lesson is about **${topic}**. The key idea is to understand the concept, identify the main terms, and practice with small examples.\n\n### Key points\n- Review the main definition first.\n- Break the topic into smaller parts.\n- Connect the concept with a real classroom or DevOps example.\n- Practice by explaining it in your own words.\n\n### Important terms\n- Core concept\n- Example\n- Practice\n- Review\n\n### Revision questions\n1. What is the main purpose of this topic?\n2. Which terms are most important?\n3. How would you explain it to a beginner?`,
    resultData: null
  };
}

function buildMockQuiz(topic) {
  return {
    type: 'quiz',
    title: `${topic} practice quiz`,
    questions: [
      {
        question: `What is the best first step when learning ${topic}?`,
        options: ['Memorize random commands', 'Understand the basic idea', 'Skip examples', 'Ignore practice'],
        answerIndex: 1,
        explanation: 'Understanding the basic idea first makes later commands and tools easier to remember.'
      },
      {
        question: 'Which habit helps students improve fastest?',
        options: ['Only reading theory', 'Copying without testing', 'Practicing with small tasks', 'Avoiding debugging'],
        answerIndex: 2,
        explanation: 'Small practical tasks turn theory into real skill and reveal gaps quickly.'
      },
      {
        question: 'In DevOps, what does CI/CD mainly help automate?',
        options: ['Build, test, and deployment', 'Manual attendance', 'Graphic design only', 'Laptop charging'],
        answerIndex: 0,
        explanation: 'CI/CD pipelines automate repeatable build, test, and release steps.'
      },
      {
        question: 'Why are containers useful in application delivery?',
        options: ['They remove all security needs', 'They package apps with dependencies', 'They replace all databases', 'They stop teams from collaborating'],
        answerIndex: 1,
        explanation: 'Containers make applications more portable by packaging code with needed runtime dependencies.'
      },
      {
        question: 'What should monitoring and logging help engineers do?',
        options: ['Hide incidents', 'Detect and investigate issues', 'Avoid learning the system', 'Delete all history'],
        answerIndex: 1,
        explanation: 'Monitoring and logging help teams detect problems and understand what happened.'
      }
    ],
    shortAnswerQuestions: [
      `Explain ${topic} in two sentences.`,
      'Give one real-world use case from a DevOps classroom project.',
      'What would you monitor after deploying this application?'
    ]
  };
}

function buildMockFlashcards(topic) {
  return {
    type: 'flashcards',
    title: `${topic} flashcards`,
    cards: [
      {
        front: `What is the main idea of ${topic}?`,
        back: 'Understand the concept, connect it to a real example, and practice it step by step.',
        hint: 'Start with the purpose, not the tool name.'
      },
      {
        front: 'What does CI/CD automate?',
        back: 'CI/CD automates build, test, and deployment workflows so releases become faster and more reliable.',
        hint: 'Think pipeline.'
      },
      {
        front: 'Why do engineers use Docker?',
        back: 'Docker packages applications with dependencies so they can run consistently across environments.',
        hint: 'Think portability.'
      },
      {
        front: 'What does Kubernetes help with?',
        back: 'Kubernetes helps run, scale, recover, and manage containers across multiple servers.',
        hint: 'Think orchestration.'
      },
      {
        front: 'Why are logs important?',
        back: 'Logs help engineers investigate incidents, understand application behavior, and debug failures.',
        hint: 'Think evidence.'
      },
      {
        front: 'What is a good way to revise technical concepts?',
        back: 'Explain the concept in your own words, build a small example, and answer practice questions.',
        hint: 'Active recall beats passive reading.'
      }
    ]
  };
}

function buildMockStudyPlan(topic, payload) {
  const dayCount = clampDays(payload.days);
  const level = String(payload.level || 'beginner');
  const examDate = String(payload.examDate || '').trim();
  const themes = [
    ['Foundation', 'Read the core definition and write a simple explanation.'],
    ['Key terms', 'List important terms, commands, services, or diagrams.'],
    ['Hands-on example', 'Build or trace a small example related to the topic.'],
    ['Debugging mindset', 'Identify common mistakes and how to troubleshoot them.'],
    ['Quiz practice', 'Answer practice questions without looking at notes.'],
    ['Teach-back', 'Explain the topic to a peer or record a short explanation.'],
    ['Final revision', 'Review weak areas and prepare a quick checklist.']
  ];

  const days = Array.from({ length: dayCount }, (_, index) => {
    const theme = themes[index % themes.length];
    const isFinal = index === dayCount - 1;
    return {
      day: index + 1,
      title: isFinal ? 'Final review and confidence check' : `${theme[0]}: ${topic}`,
      focus: isFinal ? `Review ${topic}, fix weak areas, and prepare for assessment.` : theme[1],
      activities: isFinal
        ? [
            'Review all notes and highlight weak points.',
            'Retake the quiz and explain every wrong answer.',
            'Create a one-page cheat sheet from memory.'
          ]
        : [
            `Study ${topic} for 25-30 minutes.`,
            'Write 5 bullet points in your own words.',
            'Connect the concept to one project example.'
          ],
      practice: isFinal
        ? 'Complete a timed revision quiz and explain the answers aloud.'
        : `Complete one small ${level}-level practice task and note what was confusing.`,
      outcome: isFinal
        ? 'You can explain the topic clearly and answer practice questions confidently.'
        : 'You finish the day with notes, one example, and one question to clarify.'
    };
  });

  return {
    type: 'studyPlan',
    title: `${dayCount}-day ${topic} study plan`,
    totalDays: dayCount,
    strategy: examDate
      ? `This plan uses ${dayCount} day(s) and works backward toward the exam date: ${examDate}.`
      : `This plan uses exactly ${dayCount} day(s), balancing learning, practice, revision, and final review.`,
    days,
    finalChecklist: [
      `Can I explain ${topic} without reading notes?`,
      'Can I solve or describe one practical example?',
      'Can I identify the most common mistakes?',
      'Can I answer quiz questions and explain why the correct answer is correct?'
    ]
  };
}

function normalizeStructuredData(action, value, payload) {
  if (action === 'quiz') {
    const questions = Array.isArray(value.questions) ? value.questions : [];
    return {
      type: 'quiz',
      title: value.title || 'CloudMentor quiz',
      questions: questions.slice(0, 8).map((question) => ({
        question: String(question.question || '').trim(),
        options: Array.isArray(question.options) ? question.options.slice(0, 4).map((option) => String(option)) : [],
        answerIndex: Number.isInteger(question.answerIndex) ? question.answerIndex : Number(question.answerIndex || 0),
        explanation: String(question.explanation || 'Review the notes and compare the options.').trim()
      })).filter((question) => question.question && question.options.length >= 2),
      shortAnswerQuestions: Array.isArray(value.shortAnswerQuestions)
        ? value.shortAnswerQuestions.slice(0, 4).map((question) => String(question))
        : []
    };
  }

  if (action === 'flashcards') {
    const cards = Array.isArray(value.cards) ? value.cards : [];
    return {
      type: 'flashcards',
      title: value.title || 'CloudMentor flashcards',
      cards: cards.slice(0, 12).map((card) => ({
        front: String(card.front || '').trim(),
        back: String(card.back || '').trim(),
        hint: String(card.hint || '').trim()
      })).filter((card) => card.front && card.back)
    };
  }

  if (action === 'studyPlan') {
    const dayCount = clampDays(payload.days || value.totalDays);
    let days = Array.isArray(value.days) ? value.days : [];
    days = days.slice(0, dayCount).map((day, index) => ({
      day: Number(day.day || index + 1),
      title: String(day.title || `Day ${index + 1}`).trim(),
      focus: String(day.focus || '').trim(),
      activities: Array.isArray(day.activities) ? day.activities.slice(0, 5).map((activity) => String(activity)) : [],
      practice: String(day.practice || '').trim(),
      outcome: String(day.outcome || '').trim()
    }));

    if (days.length !== dayCount) {
      return buildMockStudyPlan(extractTopic(String(payload.notes || payload.topic || 'CloudMentor topic')), payload);
    }

    return {
      type: 'studyPlan',
      title: value.title || `${dayCount}-day study plan`,
      totalDays: dayCount,
      strategy: String(value.strategy || '').trim(),
      days,
      finalChecklist: Array.isArray(value.finalChecklist)
        ? value.finalChecklist.slice(0, 6).map((item) => String(item))
        : []
    };
  }

  return value;
}

function stringifyStructuredResult(action, data) {
  if (action === 'quiz') {
    return `## ${data.title || 'Interactive Quiz'}\n\n${data.questions.map((question, index) => {
      const options = question.options.map((option, optionIndex) => `   ${String.fromCharCode(65 + optionIndex)}. ${option}`).join('\n');
      return `${index + 1}. ${question.question}\n${options}\n   Answer: ${String.fromCharCode(65 + question.answerIndex)}\n   Explanation: ${question.explanation}`;
    }).join('\n\n')}\n\n### Short-answer practice\n${(data.shortAnswerQuestions || []).map((question, index) => `${index + 1}. ${question}`).join('\n')}`;
  }

  if (action === 'flashcards') {
    return `## ${data.title || 'Flashcards'}\n\n| Front | Back | Hint |\n|---|---|---|\n${data.cards.map((card) => `| ${escapeTableText(card.front)} | ${escapeTableText(card.back)} | ${escapeTableText(card.hint || '')} |`).join('\n')}`;
  }

  if (action === 'studyPlan') {
    return `## ${data.title || 'Study Plan'}\n\n${data.strategy || ''}\n\n${data.days.map((day) => `### Day ${day.day}: ${day.title}\n**Focus:** ${day.focus}\n\n${(day.activities || []).map((activity) => `- ${activity}`).join('\n')}\n\n**Practice:** ${day.practice}\n\n**Outcome:** ${day.outcome}`).join('\n\n')}\n\n### Final checklist\n${(data.finalChecklist || []).map((item) => `- ${item}`).join('\n')}`;
  }

  return typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}

function parseAiJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;

  try {
    return JSON.parse(candidate);
  } catch {
    const first = candidate.indexOf('{');
    const last = candidate.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(candidate.slice(first, last + 1));
      } catch {
        return null;
      }
    }
  }

  return null;
}

function extractTopic(source) {
  const compact = String(source || 'CloudMentor topic').replace(/\s+/g, ' ').trim();
  const words = compact.split(' ').slice(0, 8).join(' ');
  return words || 'CloudMentor topic';
}

function clampDays(value) {
  const days = Number(value || 7);
  if (!Number.isFinite(days)) return 7;
  return Math.min(Math.max(Math.round(days), 1), 30);
}

function escapeTableText(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function isPlaceholderOpenAIKey(value) {
  const key = String(value || '').trim();
  if (!key) return true;
  const lowered = key.toLowerCase();
  return [
    'your_openai_api_key_here',
    'openaiapikey',
    'openai_api_key',
    'sk-your-key-here',
    'sk-proj-your_key_here'
  ].includes(lowered) || lowered.includes('your_openai') || lowered.includes('your-key');
}

function extractOpenAiText(data) {
  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const chunks = [];
  for (const output of data.output || []) {
    for (const content of output.content || []) {
      if (content.type === 'output_text' && content.text) {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join('\n').trim() || 'No response text returned from the model.';
}

async function saveHistory({ type, title, request, result, resultData = null }) {
  const createdAt = new Date().toISOString();
  const id = crypto.randomUUID();
  const item = {
    userId: DEMO_USER_ID,
    createdAtId: `${createdAt}#${id}`,
    id,
    type,
    title,
    request,
    result,
    resultData,
    createdAt
  };

  if (USE_LOCAL_HISTORY) {
    await saveLocalHistory(item);
    return item;
  }

  await docClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: item
  }));

  return item;
}

async function saveProgress(payload) {
  const score = Number(payload.score || 0);
  const item = await saveHistory({
    type: 'progress',
    title: `Progress: ${payload.topic || 'Study session'}`,
    request: safeRequest(payload),
    result: JSON.stringify({
      topic: payload.topic || 'General',
      score: Number.isFinite(score) ? score : 0,
      note: payload.note || '',
      completedAt: new Date().toISOString()
    }, null, 2)
  });

  return response(200, {
    saved: true,
    id: item.id,
    createdAt: item.createdAt
  });
}

async function getHistory(limit) {
  if (USE_LOCAL_HISTORY) {
    const items = await readLocalHistory();
    return items
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, limit)
      .map(formatHistoryItem);
  }

  const result = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'userId = :userId',
    ExpressionAttributeValues: {
      ':userId': DEMO_USER_ID
    },
    ScanIndexForward: false,
    Limit: limit
  }));

  return (result.Items || []).map(formatHistoryItem);
}

function formatHistoryItem(item) {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    result: item.result,
    resultData: item.resultData || null,
    createdAt: item.createdAt
  };
}

async function readLocalHistory() {
  try {
    const raw = await fs.readFile(LOCAL_HISTORY_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveLocalHistory(item) {
  const items = await readLocalHistory();
  items.push(item);
  await fs.mkdir(path.dirname(LOCAL_HISTORY_FILE), { recursive: true });
  await fs.writeFile(LOCAL_HISTORY_FILE, JSON.stringify(items.slice(-100), null, 2));
}

function validatePayload(action, payload) {
  const text = String(payload.notes || payload.topic || '').trim();

  if (!text) {
    throw new HttpError(400, 'Please provide notes or a topic. You can paste text or upload a text-based file first.');
  }

  if (text.length > MAX_EXTRACTED_CHARS) {
    throw new HttpError(400, `Input is too long for this classroom demo. Keep it under ${MAX_EXTRACTED_CHARS} characters.`);
  }

  if (action === 'studyPlan' && payload.days && Number(payload.days) > 30) {
    throw new HttpError(400, 'Study plan can be at most 30 days in this demo.');
  }
}

function safeRequest(payload) {
  const copy = { ...payload };
  if (copy.notes && copy.notes.length > 1000) {
    copy.notes = `${copy.notes.slice(0, 1000)}...`;
  }
  return copy;
}

function parseJson(body) {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, 'Invalid JSON body.');
  }
}

function buildObjectKey(originalName) {
  const now = new Date().toISOString().replace(/[:.]/g, '-');
  const id = crypto.randomUUID();
  return `uploads/${DEMO_USER_ID}/${now}__${id}__${originalName}`;
}

function sanitizeFileName(value) {
  const cleaned = String(value || 'cloudmentor-file.txt')
    .replace(/[/\\]/g, '-')
    .replace(/[^a-zA-Z0-9._ -]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 120);
  return cleaned || 'cloudmentor-file.txt';
}

function sanitizeContentType(value) {
  return String(value || 'application/octet-stream').split(';')[0].trim().slice(0, 120) || 'application/octet-stream';
}

function validateObjectKey(key) {
  if (!key || !key.startsWith(`uploads/${DEMO_USER_ID}/`)) {
    throw new HttpError(400, 'Invalid upload key.');
  }

  if (key.includes('..') || key.includes('\\')) {
    throw new HttpError(400, 'Invalid upload key.');
  }
}

function safeLocalPath(key) {
  validateObjectKey(key);
  const filePath = path.resolve(LOCAL_STORAGE_DIR, key);
  const rootPath = path.resolve(LOCAL_STORAGE_DIR);

  if (!filePath.startsWith(rootPath)) {
    throw new HttpError(400, 'Invalid local upload path.');
  }

  return filePath;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function normalizePath(pathName) {
  if (!pathName) return '/';
  const withoutTrailing = pathName.length > 1 ? pathName.replace(/\/$/, '') : pathName;
  return withoutTrailing;
}

function response(statusCode, body) {
  return {
    statusCode,
    headers,
    body: statusCode === 204 ? '' : JSON.stringify(body)
  };
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}
