/**
 * config.js — Configuration defaults
 * All defaults centralized in one file instead of scattered across 30+ files.
 */

export const CONFIG = {

  tables: {
    materials: process.env.AZURE_TABLE_MATERIALS || 'materials',
    classes: process.env.AZURE_TABLE_CLASSES || 'classes',
    enrollments: process.env.AZURE_STORAGE_ENROLLMENTS_TABLE
      || process.env.AZURE_TABLE_ENROLLMENTS
      || 'Enrollments',
    corrections: process.env.AZURE_TABLE_CORRECTIONS || 'Corrections',
    correctionsPending: process.env.AZURE_TABLE_CORRECTIONS_PENDING || 'CorrectionsPending',
    transcriptionCorrections: process.env.AZURE_TABLE_TRANSCRIPTION_CORRECTIONS || 'TranscriptionCorrections',
    conversationRatings: process.env.AZURE_TABLE_CONVERSATION_RATINGS || 'ConversationRatings',
    conversations: process.env.AZURE_TABLE_CONVERSATIONS || 'Conversations',
    classViews: process.env.AZURE_TABLE_CLASS_VIEWS || 'ClassViews',
    prompts: process.env.AZURE_TABLE_PROMPTS || 'PromptVersions',
    subjectWeights: process.env.AZURE_TABLE_SUBJECT_WEIGHTS || 'SubjectWeights',
    notificationPreferences: process.env.AZURE_TABLE_NOTIFICATION_PREFERENCES || 'NotificationPreferences',
    interventions: process.env.AZURE_TABLE_INTERVENTIONS || 'Interventions',
    riskThresholds: process.env.AZURE_TABLE_RISK_THRESHOLDS || 'RiskThresholds',
    userEvents: process.env.AZURE_TABLE_USER_EVENTS || 'UserEvents',
    quizResults: process.env.AZURE_TABLE_QUIZ_RESULTS || 'QuizResults',
    quizAttempts: process.env.AZURE_TABLE_QUIZ_ATTEMPTS || 'QuizAttempts',
    unansweredQueries: process.env.AZURE_TABLE_UNANSWERED_QUERIES || 'UnansweredQueries',
    adminSettings: process.env.AZURE_TABLE_ADMIN_SETTINGS || 'AdminSettings',
    users: process.env.AZURE_TABLE_USERS || 'Users',
    sessions: process.env.AZURE_TABLE_SESSIONS || 'Sessions',
  },

  containers: {
    classes: process.env.AZURE_STORAGE_CONTAINER_CLASSES || 'classes-config',
    materials: process.env.AZURE_STORAGE_CONTAINER_MATERIALS || 'class-materials',
    summaries: 'class-summaries',
    deadlines: 'deadlines',
    backupStatus: 'backup-status',
    tasks: process.env.AZURE_STORAGE_CONTAINER_TASKS || 'tasks-config',
    compliance: process.env.AZURE_STORAGE_CONTAINER_COMPLIANCE || 'compliance',
  },

  blobs: {
    subjects: 'subjects.json',
    backupLastRun: 'last-run.json',
  },

  ai: {
    apiVersion: '2024-08-01-preview',
    embeddingModel: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || 'text-embedding-3-small',
    chatModel: process.env.AZURE_OPENAI_CHAT_DEPLOYMENT,
    deepSeekModel: process.env.AI_FOUNDRY_DEEPSEEK_MODEL || 'deepseek-v4-flash',
    // Display label for the chat "Powered by …" indicator. Tracks the real
    // catalog model behind the deployment alias (e.g. DeepSeek-V4.1-Flash).
    // Update on each model bump — no code change needed elsewhere.
    deepSeekDisplayName: process.env.AI_FOUNDRY_DEEPSEEK_DISPLAY_NAME || '',
    deepSeekEndpoint: process.env.AI_FOUNDRY_DEEPSEEK_ENDPOINT || '',
    ttsModel: process.env.AZURE_OPENAI_TTS_DEPLOYMENT || 'tts-1',
    temperature: {
      chat: 0.3,
      summary: 0.5,
      mermaid: 0.4,
      podcast: 0.5,
      quiz: 0.4,
    },
    maxTokens: {
      chat: 1500,
      summary: 2000,
      mermaid: 1500,
      podcast: 2000,
      quiz: 3000,
      ttsInput: 4000,
    },
    defaultVoice: 'nova',
    tokenScope: 'https://cognitiveservices.azure.com/.default',
    allowedModels: ['deepseek-v4-flash', 'gpt-4o-mini'],
    models: {
      'rag-master': process.env.AI_MODEL_RAG_MASTER || process.env.AI_FOUNDRY_DEEPSEEK_MODEL || 'deepseek-v4-flash',
      rewrite: process.env.AI_MODEL_REWRITE || process.env.AI_FOUNDRY_DEEPSEEK_MODEL || 'deepseek-v4-flash',
      'class-summary': process.env.AI_MODEL_CLASS_SUMMARY || process.env.AI_FOUNDRY_DEEPSEEK_MODEL || 'deepseek-v4-flash',
      mermaid: process.env.AI_MODEL_MERMAID || process.env.AI_FOUNDRY_DEEPSEEK_MODEL || 'deepseek-v4-flash',
      'transcription-correction': process.env.AI_MODEL_TRANSCRIPTION_CORRECTION || process.env.AI_FOUNDRY_DEEPSEEK_MODEL || 'deepseek-v4-flash',
      'class-podcast': process.env.AI_MODEL_CLASS_PODCAST || process.env.AI_FOUNDRY_DEEPSEEK_MODEL || 'deepseek-v4-flash',
      quiz: process.env.AI_MODEL_QUIZ || process.env.AI_FOUNDRY_DEEPSEEK_MODEL || 'deepseek-v4-flash',
    },
  },

  rag: {
    maxChunks: 4,
    retrievalCandidates: 10,
    maxChunksPerSource: 2,
  },

  history: {
    minTurns: 3,
    maxTurns: 5,
    defaultTurns: 4,
  },

  vector: {
    batchSize: 100,
    requestTimeoutMs: 15000,
    indexName: process.env.PINECONE_INDEX_NAME || 'dashboard-edu-pilot',
  },

  cron: {
    vectorBackup: process.env.VECTOR_BACKUP_WINDOW_CRON || '0 0 3 * * *',
    postClassSummary: process.env.POST_CLASS_SUMMARY_TIMER_CRON || '0 */15 * * * *',
    deadlineProximity: process.env.DEADLINE_PROXIMITY_TIMER_CRON || '0 */30 * * * *',
    dailyReminders: process.env.DAILY_REMINDERS_TIMER_CRON || '0 0 8 * * *',
  },

  entraGroups: {
    alumnos: process.env.ENTRA_GROUP_ALUMNOS || 'Alumnos-Pilot',
    docentes: process.env.ENTRA_GROUP_DOCENTES || 'Docentes-Pilot',
    directores: process.env.ENTRA_GROUP_DIRECTORES || 'Directores-Pilot',
  },

  auth: {
    oidc: {
      tenantId: process.env.ENTRA_TENANT_ID || '',
      clientId: process.env.ENTRA_CLIENT_ID || '',
      issuer: process.env.ENTRA_ISSUER || '',
      jwksTtlMs: Number(process.env.OIDC_JWKS_TTL_MS) || 3600000,
    },
    mockEnabled: process.env.AUTH_MOCK_ENABLED === 'true',
    sessionTtlMs: Number(process.env.AUTH_SESSION_TTL_MS) || 7 * 24 * 60 * 60 * 1000,
    loginRateLimit: {
      windowMs: Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 60000,
      attempts: Number(process.env.LOGIN_RATE_LIMIT_ATTEMPTS) || 5,
    },
  },

  budget: {
    monthlyUsd: Number(process.env.DIRECTOR_BUDGET_MONTHLY_USD) || 10000,
  },

  rateLimit: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
    tiers: {
      chat: Number(process.env.RATE_LIMIT_CHAT_PER_MIN) || 30,
      ingest: Number(process.env.RATE_LIMIT_INGEST_PER_MIN) || 10,
      general: Number(process.env.RATE_LIMIT_GENERAL_PER_MIN) || 60,
    },
  },

  uploadQuota: {
    table: process.env.AZURE_TABLE_UPLOAD_QUOTA || 'UploadQuota',
    maxFilesPerTeacher: Number(process.env.UPLOAD_QUOTA_MAX_FILES_PER_TEACHER) || 100,
    maxBytesPerTeacher: Number(process.env.UPLOAD_QUOTA_MAX_BYTES_PER_TEACHER) || 5 * 1024 * 1024 * 1024,
  },

  timezone: process.env.DEFAULT_TIMEZONE || 'America/Argentina/Buenos_Aires',

  deadline: {
    windowHours: Number(process.env.DEADLINE_PROXIMITY_WINDOW_HOURS) || 48,
    highPriorityWeightThreshold: Number(process.env.DEADLINE_HIGH_PRIORITY_WEIGHT_THRESHOLD) || 25,
  },

  validCadences: ['48h', '24h', 'both'],

  sat: {
    minRatedThreshold: Number(process.env.SAT_MIN_RATED_THRESHOLD) || 10,
  },

  notifications: {
    // El endpoint SSE debe cerrar la conexión bastante antes de que el host
    // mate la ejecución (el límite duro de HTTP en Consumption ronda los 230 s).
    // Cerrar primero y dejar que el cliente reconecte mantiene las duraciones
    // acotadas en lugar de terminar en un FunctionTimeoutException.
    streamMaxMs: Number(process.env.NOTIFICATION_STREAM_MAX_MS) || 110000,
    streamPollMs: Number(process.env.NOTIFICATION_STREAM_POLL_MS) || 5000,
  },

  materialWeights: {
    notes: 1.35,
    bibliography: 1.1,
    transcript: 1.0,
    presentation: 0.95,
  },

  weightMin: 0.0,
  weightMax: 3.0,

  materialPriorityWeights: {
    primary: 1,
    secondary: 0.9,
  },
};