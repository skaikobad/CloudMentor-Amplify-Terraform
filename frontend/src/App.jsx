import { useEffect, useMemo, useState } from 'react';
import {
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Copy,
  Database,
  Eye,
  FileText,
  FileUp,
  GraduationCap,
  HardDrive,
  History,
  Layers3,
  Loader2,
  RotateCcw,
  Server,
  ShieldCheck,
  Sparkles,
  Trophy,
  UploadCloud,
  Wand2,
  Workflow,
  XCircle
} from 'lucide-react';
import { api } from './api.js';

const taskMap = {
  summarize: {
    label: 'Summarize Notes',
    icon: FileText,
    description: 'Turn long notes into key points, terms, examples, and revision questions.'
  },
  quiz: {
    label: 'Generate Quiz',
    icon: GraduationCap,
    description: 'Create an interactive MCQ quiz with instant correct/wrong feedback.'
  },
  flashcards: {
    label: 'Create Flashcards',
    icon: Layers3,
    description: 'Convert notes into flippable review cards for active recall.'
  },
  studyPlan: {
    label: 'Build Study Plan',
    icon: CalendarDays,
    description: 'Create an exact day-by-day plan based on your requested number of days.'
  }
};

const pipelineSteps = [
  { label: 'React UI', detail: 'Paste or upload', icon: Cloud },
  { label: 'API Gateway', detail: 'Secure routes', icon: Workflow },
  { label: 'Lambda', detail: 'Serverless logic', icon: Server },
  { label: 'S3', detail: 'Study files', icon: HardDrive },
  { label: 'OpenAI', detail: 'AI mentor brain', icon: BrainCircuit },
  { label: 'DynamoDB', detail: 'History & progress', icon: Database }
];

const sampleNotes = `DevOps combines software development and IT operations to deliver applications faster and more reliably. CI/CD automates build, test, and deployment. Docker packages applications into containers. Kubernetes helps run and scale containers across multiple servers. Monitoring and logging help engineers detect incidents quickly.`;

const MAX_FILE_BYTES = 2 * 1024 * 1024;

function App() {
  const [task, setTask] = useState('summarize');
  const [notes, setNotes] = useState(sampleNotes);
  const [level, setLevel] = useState('beginner');
  const [days, setDays] = useState(7);
  const [examDate, setExamDate] = useState('');
  const [result, setResult] = useState('');
  const [resultData, setResultData] = useState(null);
  const [resultTitle, setResultTitle] = useState('Your CloudMentor output will appear here');
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState('Not checked');
  const [storageMode, setStorageMode] = useState('Unknown');
  const [aiMode, setAiMode] = useState('Unknown');
  const [error, setError] = useState('');
  const [progressTopic, setProgressTopic] = useState('DevOps Fundamentals');
  const [progressScore, setProgressScore] = useState(80);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadInfo, setUploadInfo] = useState('No file uploaded yet.');
  const [quizAnswers, setQuizAnswers] = useState({});
  const [flashcardIndex, setFlashcardIndex] = useState(0);
  const [flashcardFlipped, setFlashcardFlipped] = useState(false);
  const [hintVisible, setHintVisible] = useState(false);

  const selectedTask = taskMap[task];
  const SelectedIcon = selectedTask.icon;

  const wordCount = useMemo(() => {
    return notes.trim() ? notes.trim().split(/\s+/).length : 0;
  }, [notes]);

  const quizScore = useMemo(() => {
    const questions = getQuizQuestions(resultData);
    const answered = questions.filter((_, index) => quizAnswers[index] !== undefined).length;
    const correct = questions.filter((question, index) => quizAnswers[index] === question.answerIndex).length;
    return { answered, correct, total: questions.length };
  }, [quizAnswers, resultData]);

  useEffect(() => {
    checkHealth();
    loadHistory();
  }, []);

  useEffect(() => {
    setQuizAnswers({});
    setFlashcardIndex(0);
    setFlashcardFlipped(false);
    setHintVisible(false);
  }, [resultData, result]);

  async function checkHealth() {
    try {
      const data = await api.health();
      setStatus(data.ok ? 'Connected' : 'Unknown');
      setStorageMode(data.storageMode || 'Unknown');
      setAiMode(data.aiMode || 'Unknown');
      setError('');
    } catch (err) {
      setStatus('Backend not connected');
      setStorageMode('Unknown');
      setAiMode('Unknown');
      setError(err.message);
    }
  }

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const data = await api.history();
      setHistory(data.items || []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function handleGenerate() {
    setError('');
    setLoading(true);
    setResult('');
    setResultData(null);
    setResultTitle('Generating response...');

    const payload = {
      notes,
      level,
      days: normalizeDays(days),
      examDate
    };

    try {
      const runner = {
        summarize: api.summarize,
        quiz: api.quiz,
        flashcards: api.flashcards,
        studyPlan: api.studyPlan
      }[task];

      const data = await runner(payload);
      setResult(data.result || 'No result returned.');
      setResultData(data.resultData || parseStructuredResult(data.result));
      setResultTitle(data.title || selectedTask.label);
      await loadHistory();
    } catch (err) {
      setError(err.message);
      setResultTitle('Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  function handleFileChange(event) {
    const file = event.target.files?.[0] || null;
    setSelectedFile(file);
    setUploadInfo(file ? `${file.name} selected. Ready to upload.` : 'No file uploaded yet.');
  }

  async function handleUploadFile() {
    if (!selectedFile) {
      setError('Choose a file first.');
      return;
    }

    if (selectedFile.size > MAX_FILE_BYTES) {
      setError('File is too large for this classroom demo. Keep uploads under 2 MB.');
      return;
    }

    setError('');
    setUploading(true);
    setUploadInfo('Preparing secure upload URL...');

    try {
      const upload = await api.createUploadUrl({
        fileName: selectedFile.name,
        contentType: selectedFile.type || guessContentType(selectedFile.name),
        size: selectedFile.size
      });

      setUploadInfo(upload.mode === 's3' ? 'Uploading file directly to S3...' : 'Uploading file to local SAM storage...');
      const localUploadResult = await api.uploadFile(upload, selectedFile);

      const processed = upload.mode === 'local'
        ? localUploadResult
        : await api.processFile({
            key: upload.key,
            originalName: selectedFile.name,
            contentType: selectedFile.type || guessContentType(selectedFile.name)
          });

      if (processed.textSupported && processed.extractedText) {
        setNotes((current) => {
          const separator = current.trim() ? `\n\n--- Uploaded file: ${selectedFile.name} ---\n` : '';
          return `${current.trim()}${separator}${processed.extractedText}`.trim();
        });
        setUploadInfo(`Uploaded ${selectedFile.name} to ${processed.storageMode}. Loaded ${processed.extractedText.length.toLocaleString()} characters into the notes box.`);
      } else {
        setUploadInfo(processed.message || `Uploaded ${selectedFile.name}, but text could not be extracted automatically.`);
      }

      await loadHistory();
    } catch (err) {
      setError(err.message);
      setUploadInfo('Upload failed. Check backend logs and CORS settings.');
    } finally {
      setUploading(false);
    }
  }

  async function handleSaveProgress() {
    setError('');
    try {
      await api.saveProgress({
        topic: progressTopic,
        score: Number(progressScore),
        note: 'Saved from CloudMentor frontend.'
      });
      await loadHistory();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCopy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  function openHistoryItem(item) {
    setResultTitle(item.title);
    setResult(item.result);
    setResultData(item.resultData || parseStructuredResult(item.result));
  }

  function chooseQuizAnswer(questionIndex, optionIndex) {
    setQuizAnswers((current) => ({ ...current, [questionIndex]: optionIndex }));
  }

  function resetQuiz() {
    setQuizAnswers({});
  }

  function nextFlashcard(cards) {
    setFlashcardIndex((current) => (current + 1) % cards.length);
    setFlashcardFlipped(false);
    setHintVisible(false);
  }

  function previousFlashcard(cards) {
    setFlashcardIndex((current) => (current - 1 + cards.length) % cards.length);
    setFlashcardFlipped(false);
    setHintVisible(false);
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="hero-panel">
          <div className="eyebrow">
            <Sparkles size={16} /> Serverless AI classroom pipeline
          </div>

          <h1>CloudMentor</h1>
          <p>
            A modern React learning assistant powered by AWS Lambda, S3, DynamoDB, and OpenAI.
            Students can paste notes, upload study files, generate interactive quizzes, flip flashcards,
            and build exact day-by-day study plans in one cloud-native project.
          </p>

          <div className="pipeline-badge" aria-label="CloudMentor architecture path">
            <span>React</span>
            <span>→</span>
            <span>API Gateway</span>
            <span>→</span>
            <span>Lambda</span>
            <span>→</span>
            <span>S3</span>
            <span>→</span>
            <span>OpenAI</span>
          </div>

          <div className="hero-actions">
            <button type="button" className="primary-button" onClick={handleGenerate} disabled={loading}>
              {loading ? <Loader2 className="spin" size={18} /> : <Wand2 size={18} />}
              {loading ? 'Generating...' : `Run ${selectedTask.label}`}
            </button>
            <button type="button" className="ghost-button" onClick={checkHealth}>
              Check Backend
            </button>
          </div>
        </div>

        <div className="hero-pipeline" aria-label="Backend status and architecture">
          <div className="status-card">
            <BrainCircuit size={42} />
            <div>
              <span className={`status-pill ${status === 'Connected' ? 'good' : 'warn'}`}>{status}</span>
              <small>Storage mode: {storageMode}</small>
              <small>AI mode: {aiMode}</small>
            </div>
          </div>

          <div className="pipeline-map">
            {pipelineSteps.map((step, index) => {
              const Icon = step.icon;
              return (
                <div className="pipeline-step" key={step.label}>
                  <div className="step-node">
                    <Icon size={20} />
                  </div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                  {index < pipelineSteps.length - 1 && <i aria-hidden="true">→</i>}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="metrics-grid four">
        <Metric label="Current task" value={selectedTask.label} />
        <Metric label="Input size" value={`${wordCount} words`} />
        <Metric label="Difficulty" value={level} />
        <Metric label="AI mode" value={aiMode} />
      </section>

      {error && (
        <section className="error-box" role="alert">
          <strong>Issue:</strong> {error}
        </section>
      )}

      <section className="workspace">
        <div className="panel glass-card">
          <div className="panel-header">
            <div>
              <span className="section-kicker">Input</span>
              <h2>Choose an AI action</h2>
            </div>
            <SelectedIcon size={24} />
          </div>

          <div className="task-grid" role="radiogroup" aria-label="AI task selector">
            {Object.entries(taskMap).map(([key, item]) => {
              const Icon = item.icon;
              return (
                <button
                  type="button"
                  key={key}
                  className={`task-card ${task === key ? 'active' : ''}`}
                  onClick={() => setTask(key)}
                >
                  <Icon size={20} />
                  <span>{item.label}</span>
                  <small>{item.description}</small>
                </button>
              );
            })}
          </div>

          <label className="field-label" htmlFor="notes">
            Notes or topic
          </label>
          <textarea
            id="notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Paste class notes, a concept, or a lesson topic here..."
          />

          <div className="upload-card">
            <div className="upload-heading">
              <UploadCloud size={22} />
              <div>
                <strong>Upload study material</strong>
                <span>Stored in S3 after deployment. SAM local uses local file storage.</span>
              </div>
            </div>

            <label className="file-picker" htmlFor="study-file">
              <FileUp size={20} />
              <span>{selectedFile ? selectedFile.name : 'Choose .txt, .md, .csv, .json, .yaml, .log, PDF, or DOCX'}</span>
              <input
                id="study-file"
                type="file"
                accept=".txt,.md,.markdown,.csv,.json,.yaml,.yml,.log,.pdf,.doc,.docx"
                onChange={handleFileChange}
              />
            </label>

            <div className="upload-actions">
              <button type="button" className="ghost-button small" onClick={handleUploadFile} disabled={uploading || !selectedFile}>
                {uploading ? <Loader2 className="spin" size={17} /> : <ShieldCheck size={17} />}
                {uploading ? 'Uploading...' : 'Upload & Load Text'}
              </button>
              {selectedFile && <span className="file-size">{formatBytes(selectedFile.size)}</span>}
            </div>

            <p className="upload-note">{uploadInfo}</p>
          </div>

          <div className="form-row">
            <label>
              Level
              <select value={level} onChange={(event) => setLevel(event.target.value)}>
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </label>

            <label>
              Study days
              <input
                type="number"
                min="1"
                max="30"
                value={days}
                onChange={(event) => setDays(event.target.value)}
              />
            </label>
          </div>

          <label className="field-label" htmlFor="exam-date">
            Exam date, optional
          </label>
          <input
            id="exam-date"
            type="date"
            value={examDate}
            onChange={(event) => setExamDate(event.target.value)}
          />

          <button type="button" className="full-button" onClick={handleGenerate} disabled={loading || !notes.trim()}>
            {loading ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
            Generate with CloudMentor
          </button>
        </div>

        <div className="panel glass-card result-panel">
          <div className="panel-header">
            <div>
              <span className="section-kicker">Output</span>
              <h2>{resultTitle}</h2>
            </div>
            <button type="button" className="icon-button" onClick={handleCopy} disabled={!result} aria-label="Copy result">
              {copied ? <CheckCircle2 size={20} /> : <Copy size={20} />}
            </button>
          </div>

          <div className="result-box">
            {loading ? (
              <div className="loading-state">
                <Loader2 className="spin" size={28} />
                <p>Calling Lambda and asking the CloudMentor brain...</p>
              </div>
            ) : result ? (
              <ResultRenderer
                task={task}
                result={result}
                resultData={resultData}
                quizAnswers={quizAnswers}
                quizScore={quizScore}
                onChooseAnswer={chooseQuizAnswer}
                onResetQuiz={resetQuiz}
                flashcardIndex={flashcardIndex}
                flashcardFlipped={flashcardFlipped}
                hintVisible={hintVisible}
                setFlashcardFlipped={setFlashcardFlipped}
                setHintVisible={setHintVisible}
                nextFlashcard={nextFlashcard}
                previousFlashcard={previousFlashcard}
              />
            ) : (
              <div className="empty-state">
                <BrainCircuit size={44} />
                <p>Paste notes or upload a text file, choose a task, and generate your first AI learning asset.</p>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="bottom-grid">
        <div className="glass-card mini-panel">
          <div className="panel-header compact">
            <div>
              <span className="section-kicker">Progress</span>
              <h2>Save a quiz score</h2>
            </div>
            <CheckCircle2 size={22} />
          </div>

          <label className="field-label" htmlFor="progress-topic">Topic</label>
          <input
            id="progress-topic"
            value={progressTopic}
            onChange={(event) => setProgressTopic(event.target.value)}
          />

          <label className="field-label" htmlFor="progress-score">Score</label>
          <input
            id="progress-score"
            type="range"
            min="0"
            max="100"
            value={progressScore}
            onChange={(event) => setProgressScore(event.target.value)}
          />
          <div className="score-line">
            <span>{progressScore}%</span>
            <button type="button" className="ghost-button small" onClick={handleSaveProgress}>Save Progress</button>
          </div>
        </div>

        <div className="glass-card mini-panel history-panel">
          <div className="panel-header compact">
            <div>
              <span className="section-kicker">History</span>
              <h2>Recent AI outputs</h2>
            </div>
            <History size={22} />
          </div>

          {historyLoading ? (
            <p className="muted">Loading history...</p>
          ) : history.length ? (
            <div className="history-list">
              {history.map((item) => (
                <button type="button" key={item.id} onClick={() => openHistoryItem(item)}>
                  <strong>{item.title}</strong>
                  <span>{new Date(item.createdAt).toLocaleString()}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted">No history yet. Generate or upload something first.</p>
          )}
        </div>
      </section>
    </main>
  );
}

function ResultRenderer({
  task,
  result,
  resultData,
  quizAnswers,
  quizScore,
  onChooseAnswer,
  onResetQuiz,
  flashcardIndex,
  flashcardFlipped,
  hintVisible,
  setFlashcardFlipped,
  setHintVisible,
  nextFlashcard,
  previousFlashcard
}) {
  if (task === 'quiz' && getQuizQuestions(resultData).length) {
    const questions = getQuizQuestions(resultData);
    return (
      <div className="interactive-output">
        <div className="quiz-header">
          <div>
            <span className="section-kicker">Interactive quiz</span>
            <h3>Answer each question and get instant feedback</h3>
          </div>
          <div className="score-badge">
            <Trophy size={18} />
            {quizScore.correct}/{quizScore.total} correct
          </div>
        </div>

        <div className="quiz-progress" aria-label="Quiz progress">
          <span style={{ width: `${quizScore.total ? (quizScore.answered / quizScore.total) * 100 : 0}%` }} />
        </div>

        <div className="quiz-list">
          {questions.map((question, questionIndex) => {
            const selected = quizAnswers[questionIndex];
            const hasAnswered = selected !== undefined;
            const isCorrect = selected === question.answerIndex;
            return (
              <article className="quiz-card" key={`${question.question}-${questionIndex}`}>
                <div className="quiz-question-row">
                  <span>Q{questionIndex + 1}</span>
                  <strong>{question.question}</strong>
                </div>
                <div className="answer-grid">
                  {question.options.map((option, optionIndex) => {
                    const isSelected = selected === optionIndex;
                    const isAnswer = question.answerIndex === optionIndex;
                    const answerClass = hasAnswered && isAnswer
                      ? 'correct'
                      : hasAnswered && isSelected && !isAnswer
                        ? 'wrong'
                        : '';
                    return (
                      <button
                        type="button"
                        className={`answer-option ${answerClass} ${isSelected ? 'selected' : ''}`}
                        key={`${option}-${optionIndex}`}
                        onClick={() => onChooseAnswer(questionIndex, optionIndex)}
                      >
                        <span>{String.fromCharCode(65 + optionIndex)}</span>
                        <em>{option}</em>
                        {hasAnswered && isAnswer && <CheckCircle2 size={18} />}
                        {hasAnswered && isSelected && !isAnswer && <XCircle size={18} />}
                      </button>
                    );
                  })}
                </div>
                {hasAnswered && (
                  <p className={`answer-feedback ${isCorrect ? 'correct' : 'wrong'}`}>
                    {isCorrect ? 'Correct.' : 'Not quite.'} {question.explanation}
                  </p>
                )}
              </article>
            );
          })}
        </div>

        {Array.isArray(resultData?.shortAnswerQuestions) && resultData.shortAnswerQuestions.length > 0 && (
          <div className="short-answer-box">
            <strong>Short-answer practice</strong>
            <ol>
              {resultData.shortAnswerQuestions.map((question, index) => (
                <li key={`${question}-${index}`}>{question}</li>
              ))}
            </ol>
          </div>
        )}

        <button type="button" className="ghost-button small" onClick={onResetQuiz}>
          <RotateCcw size={16} /> Reset quiz
        </button>
      </div>
    );
  }

  if (task === 'flashcards' && getFlashcards(resultData).length) {
    const cards = getFlashcards(resultData);
    const current = cards[Math.min(flashcardIndex, cards.length - 1)];
    return (
      <div className="interactive-output flashcard-output">
        <div className="quiz-header">
          <div>
            <span className="section-kicker">Flashcards</span>
            <h3>Flip the card, test recall, then move next</h3>
          </div>
          <div className="score-badge">{flashcardIndex + 1}/{cards.length}</div>
        </div>

        <button type="button" className={`flashcard ${flashcardFlipped ? 'flipped' : ''}`} onClick={() => setFlashcardFlipped(!flashcardFlipped)}>
          <span className="flashcard-label">{flashcardFlipped ? 'Back' : 'Front'}</span>
          <strong>{flashcardFlipped ? current.back : current.front}</strong>
          <small>{flashcardFlipped ? 'Click to see the question again' : 'Think first, then click to reveal the answer'}</small>
        </button>

        {current.hint && (
          <div className="hint-box">
            <button type="button" className="ghost-button small" onClick={() => setHintVisible(!hintVisible)}>
              <Eye size={16} /> {hintVisible ? 'Hide hint' : 'Show hint'}
            </button>
            {hintVisible && <p>{current.hint}</p>}
          </div>
        )}

        <div className="flashcard-controls">
          <button type="button" className="ghost-button small" onClick={() => previousFlashcard(cards)}>
            <ChevronLeft size={16} /> Previous
          </button>
          <button type="button" className="primary-button small-pill" onClick={() => setFlashcardFlipped(!flashcardFlipped)}>
            Flip Card
          </button>
          <button type="button" className="ghost-button small" onClick={() => nextFlashcard(cards)}>
            Next <ChevronRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  if (task === 'studyPlan' && getStudyDays(resultData).length) {
    const planDays = getStudyDays(resultData);
    return (
      <div className="interactive-output">
        <div className="quiz-header">
          <div>
            <span className="section-kicker">Study plan</span>
            <h3>{planDays.length} exact study days</h3>
          </div>
          <div className="score-badge"><CalendarDays size={18} /> {planDays.length} days</div>
        </div>

        {resultData?.strategy && <p className="plan-strategy">{resultData.strategy}</p>}

        <div className="study-plan-list">
          {planDays.map((day) => (
            <article className="study-day-card" key={day.day}>
              <div className="day-number">Day {day.day}</div>
              <div>
                <h3>{day.title}</h3>
                <p><strong>Focus:</strong> {day.focus}</p>
                {Array.isArray(day.activities) && day.activities.length > 0 && (
                  <ul>
                    {day.activities.map((activity, index) => <li key={`${activity}-${index}`}>{activity}</li>)}
                  </ul>
                )}
                {day.practice && <p><strong>Practice:</strong> {day.practice}</p>}
                {day.outcome && <p><strong>Outcome:</strong> {day.outcome}</p>}
              </div>
            </article>
          ))}
        </div>

        {Array.isArray(resultData?.finalChecklist) && resultData.finalChecklist.length > 0 && (
          <div className="short-answer-box">
            <strong>Final checklist</strong>
            <ol>
              {resultData.finalChecklist.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
            </ol>
          </div>
        )}
      </div>
    );
  }

  return <pre>{result}</pre>;
}

function Metric({ label, value }) {
  return (
    <div className="metric glass-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function getQuizQuestions(resultData) {
  return Array.isArray(resultData?.questions)
    ? resultData.questions
        .map((question) => ({
          ...question,
          options: Array.isArray(question.options) ? question.options : [],
          answerIndex: Number(question.answerIndex)
        }))
        .filter((question) => question.question && question.options.length >= 2 && Number.isInteger(question.answerIndex))
    : [];
}

function getFlashcards(resultData) {
  return Array.isArray(resultData?.cards)
    ? resultData.cards.filter((card) => card.front && card.back)
    : [];
}

function getStudyDays(resultData) {
  return Array.isArray(resultData?.days)
    ? resultData.days.filter((day) => day.day && day.title)
    : [];
}

function parseStructuredResult(result) {
  if (!result || typeof result !== 'string') return null;
  const trimmed = result.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function normalizeDays(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 7;
  return Math.min(Math.max(Math.round(number), 1), 30);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function guessContentType(fileName) {
  const extension = fileName.split('.').pop()?.toLowerCase();
  const map = {
    txt: 'text/plain',
    md: 'text/markdown',
    markdown: 'text/markdown',
    csv: 'text/csv',
    json: 'application/json',
    yaml: 'application/x-yaml',
    yml: 'application/x-yaml',
    log: 'text/plain',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  };
  return map[extension] || 'application/octet-stream';
}

export default App;
