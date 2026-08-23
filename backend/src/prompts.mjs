export function buildPrompt(action, payload) {
  const notes = sanitizeText(payload.notes || payload.topic || '');
  const level = sanitizeText(payload.level || 'beginner');
  const examDate = sanitizeText(payload.examDate || 'not provided');
  const days = clampDays(payload.days || 7);

  const sharedRules = `
You are CloudMentor, a friendly teaching assistant for students.
Keep the response clear, practical, and age-appropriate.
Avoid unsafe, explicit, or harmful instructions.
Prefer examples that are simple and classroom-friendly.
Student level: ${level}.
`.trim();

  const prompts = {
    summarize: `${sharedRules}

Task: Summarize the following notes.
Return Markdown with this structure:
1. Short summary
2. Key points
3. Important terms
4. Simple example
5. 3 revision questions

Notes:
${notes}`,

    quiz: `${sharedRules}

Task: Create an interactive quiz from the notes.
Return ONLY valid JSON. Do not wrap it in Markdown or code fences.
The JSON shape must be exactly:
{
  "type": "quiz",
  "title": "short quiz title",
  "questions": [
    {
      "question": "question text",
      "options": ["A option", "B option", "C option", "D option"],
      "answerIndex": 0,
      "explanation": "one short explanation"
    }
  ],
  "shortAnswerQuestions": ["short answer question 1", "short answer question 2"]
}
Rules:
- Create exactly 5 multiple-choice questions.
- Each question must have exactly 4 options.
- answerIndex must be a number from 0 to 3.
- Questions should test understanding, not memorization only.
- Difficulty: ${level}

Notes:
${notes}`,

    flashcards: `${sharedRules}

Task: Create flashcards from the notes.
Return ONLY valid JSON. Do not wrap it in Markdown or code fences.
The JSON shape must be exactly:
{
  "type": "flashcards",
  "title": "short flashcard deck title",
  "cards": [
    {
      "front": "question or prompt shown first",
      "back": "answer shown after flip",
      "hint": "small hint for active recall"
    }
  ]
}
Rules:
- Create 8 to 10 cards.
- Front should be short and question-like.
- Back should be clear and practical.
- Hint should help recall without giving the full answer.

Notes:
${notes}`,

    studyPlan: `${sharedRules}

Task: Create a meaningful study plan.
Exam date: ${examDate}
Number of days requested: ${days}
Return ONLY valid JSON. Do not wrap it in Markdown or code fences.
The JSON shape must be exactly:
{
  "type": "studyPlan",
  "title": "short plan title",
  "totalDays": ${days},
  "strategy": "one sentence explaining the plan",
  "days": [
    {
      "day": 1,
      "title": "daily title",
      "focus": "main learning focus",
      "activities": ["activity 1", "activity 2", "activity 3"],
      "practice": "daily practical task",
      "outcome": "what the student should achieve"
    }
  ],
  "finalChecklist": ["checklist item 1", "checklist item 2"]
}
Rules:
- The days array must contain exactly ${days} items, no more and no less.
- Day numbers must start at 1 and end at ${days}.
- Each day must include learning, practice, and revision.
- For short plans, compress intelligently. For longer plans, gradually increase practice and revision.
- Make it realistic for students.

Topics or notes:
${notes}`,

    explain: `${sharedRules}

Task: Explain the following concept simply, then explain it with a real-world technical example.

Concept:
${notes}`
  };

  return prompts[action] || prompts.explain;
}

export function titleFor(action, payload) {
  const raw = payload.topic || payload.notes || action;
  const compact = sanitizeText(raw).replace(/\s+/g, ' ').slice(0, 70);
  const label = {
    summarize: 'Summary',
    quiz: 'Interactive Quiz',
    flashcards: 'Flashcards',
    studyPlan: `${clampDays(payload.days || 7)}-Day Study Plan`,
    progress: 'Progress'
  }[action] || 'AI Response';
  return compact ? `${label}: ${compact}` : label;
}

function sanitizeText(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .trim();
}

function clampDays(value) {
  const days = Number(value || 7);
  if (!Number.isFinite(days)) return 7;
  return Math.min(Math.max(Math.round(days), 1), 30);
}
