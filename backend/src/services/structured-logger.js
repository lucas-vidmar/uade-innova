const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const DEFAULT_LEVEL = 'info';

function currentLevel() {
  return LOG_LEVELS[process.env.LOG_LEVEL] ?? LOG_LEVELS[DEFAULT_LEVEL];
}

function shouldLog(level) {
  return LOG_LEVELS[level] >= currentLevel();
}

function truncate(str, max) {
  if (!str) return '';
  const s = String(str);
  return s.length > max ? s.slice(0, max) + '...' : s;
}

function pickContextFields(context) {
  if (!context || typeof context !== 'object') return {};
  const fields = {};
  if (context.correlationId) fields.correlationId = context.correlationId;
  if (context.userId) fields.userId = context.userId;
  if (context.subjectId) fields.subjectId = context.subjectId;
  if (context.classId) fields.classId = context.classId;
  if (context.materialId) fields.materialId = context.materialId;
  if (context.invocationId) fields.invocationId = context.invocationId;
  return fields;
}

function captureDebugRequest(request) {
  if (!request) return {};
  const method = request.method || 'UNKNOWN';
  const url = request.url || '';
  let bodySnippet = '';
  try {
    if (request.body) {
      const raw = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
      bodySnippet = truncate(raw, 2000);
    }
  } catch {
    bodySnippet = '(unable to stringify body)';
  }
  return { method, url: truncate(url, 500), bodySnippet };
}

function captureDebugResponse(result) {
  if (!result) return {};
  const status = result.status || result.statusCode || 0;
  const durationMs = result._durationMs || 0;
  return { status, durationMs };
}

export function createStructuredLogger(functionName, context) {
  const baseFields = {
    functionName,
    timestamp: new Date().toISOString(),
    ...pickContextFields(context),
  };

  function emit(level, message, extra) {
    if (!shouldLog(level)) return;
    const entry = { ...baseFields, level, message, ...(extra || {}) };
    if (level === 'error') {
      context.error(JSON.stringify(entry));
    } else if (level === 'warn') {
      context.warn(JSON.stringify(entry));
    } else {
      context.log(JSON.stringify(entry));
    }
  }

  return {
    info: (msg, extra) => emit('info', msg, extra),
    warn: (msg, extra) => emit('warn', msg, extra),
    error: (msg, extra) => emit('error', msg, extra),
    debug: (msg, extra) => emit('debug', msg, extra),

    debugRequest(request) {
      if (!shouldLog('debug')) return;
      emit('debug', 'HTTP request', captureDebugRequest(request));
    },

    debugResponse(result) {
      if (!shouldLog('debug')) return;
      emit('debug', 'HTTP response', captureDebugResponse(result));
    },
  };
}
