import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { withCorrelation, withCorrelationTimer } from '../middleware/with-correlation.js';
import { loadJson, listBlobs } from '../services/storage.js';
import { dispatchClassSummaryNotification } from '../services/notification-store.js';
import { trackDispatcherRun } from '../services/telemetry.js';
import { CONFIG } from '../services/config.js';

const CONTAINER_CLASSES = CONFIG.containers.classes;
const CONTAINER_SUMMARIES = CONFIG.containers.summaries;
const SUBJECTS_BLOB = CONFIG.blobs.subjects;

function isPastClassDate(value, now = new Date()) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getTime() <= now.getTime();
}

async function loadSubjectIds() {
  const subjects = await loadJson(CONTAINER_CLASSES, SUBJECTS_BLOB);
  if (Array.isArray(subjects) && subjects.length > 0) {
    return subjects.map((item) => String(item?.id || '').trim()).filter(Boolean);
  }

  const blobs = await listBlobs(CONTAINER_CLASSES);
  return blobs
    .filter((name) => name.endsWith('.json') && name !== SUBJECTS_BLOB)
    .map((name) => name.replace(/\.json$/, ''))
    .filter(Boolean);
}

async function shouldDispatchForClass(classData) {
  if (!classData?.id) return false;
  if (!isPastClassDate(classData.date)) return false;

  if (classData.summaryReady === true) return true;

  const summary = await loadJson(CONTAINER_SUMMARIES, `${classData.id}.json`);
  return summary?.validated === true;
}

export async function runPostClassSummaryDispatcher(context = { log: () => {}, error: () => {} }) {
  const startedAt = Date.now();
  const subjectIds = await loadSubjectIds();
  let dispatched = 0;
  let classCount = 0;
  let skipped = 0;
  let errors = 0;
  let retryAttempts = 0;
  let deadLetterWrites = 0;
  const errorEntries = [];

  for (const subjectId of subjectIds) {
    const classes = await loadJson(CONTAINER_CLASSES, `${subjectId}.json`);
    if (!Array.isArray(classes) || classes.length === 0) continue;

    for (const classData of classes) {
      classCount += 1;
      try {
        const shouldDispatch = await shouldDispatchForClass(classData);
        if (!shouldDispatch) {
          skipped += 1;
          continue;
        }

        const classId = String(classData.id);
        const { retryAttempts: retries, deadLetterWrites: dlWrites } = await dispatchClassSummaryNotification({
          subjectId,
          classData,
          origin: 'post-class-summary-timer',
        });

        retryAttempts += retries;
        deadLetterWrites += dlWrites;
        dispatched += 1;
      } catch (err) {
        errors += 1;
        errorEntries.push(`subject=${subjectId} class=${String(classData.id) || 'unknown'}`);
        context.error(`[post-class-summary-dispatcher] subject=${subjectId} class=${String(classData.id) || 'unknown'} error=${err.message}`);
      }
    }
  }

  const durationMs = Date.now() - startedAt;

  context.log(`[post-class-summary-dispatcher] completed; subjects=${subjectIds.length} classes=${classCount} dispatched=${dispatched} skipped=${skipped} errors=${errors} retryAttempts=${retryAttempts} deadLetterWrites=${deadLetterWrites} duration=${durationMs}ms`);

  try {
    await trackDispatcherRun({
      dispatcherName: 'post-class-summary',
      subjectCount: subjectIds.length,
      classCount,
      dispatched,
      skipped,
      errors,
      retryAttempts,
      deadLetterWrites,
      durationMs,
      errorDetails: errorEntries.length > 0 ? errorEntries.join(' | ') : undefined,
    });
  } catch (telemetryErr) {
    context.error(`[post-class-summary-dispatcher] telemetry error: ${telemetryErr.message}`);
  }

  return { dispatched, subjectCount: subjectIds.length, classCount, skipped, errors, retryAttempts, deadLetterWrites, durationMs };
}

app.timer('post-class-summary-dispatcher', {
  schedule: CONFIG.cron.postClassSummary,
  handler: withCorrelationTimer(async (_timer, context) => {
    await runPostClassSummaryDispatcher(context);
  }),
});

// ── POST /api/class-summary/{classId}/publish-now ──────────────────
// 11-4-10: Publicación retroactiva manual. El docente puede disparar
// la notificación de "resumen publicado" de una clase pasada sin esperar
// el próximo tick del timer.
app.http('publish-class-summary-now', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'class-summary/{classId}/publish-now',
  handler: withCorrelation(withAuth(async (request, context) => {
    const { validateFrontDoorId, parseClientPrincipal } = await import('../services/auth-utils.js');
    if (!validateFrontDoorId(request)) {
      return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
    }

    const principal = parseClientPrincipal(request);
    const isAuthorized = principal?.userRoles?.some(role => ['Docente', 'Director'].includes(role))
      || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development';
    if (!isAuthorized) {
      return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Forbidden - Teacher access required' }) };
    }

    const classId = request.params.classId;
    const subjectId = request.query.get('subjectId');
    if (!classId || !subjectId) {
      return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Faltan classId y subjectId' }) };
    }

    try {
      const classes = await loadJson(CONTAINER_CLASSES, `${subjectId}.json`);
      const classData = Array.isArray(classes) ? classes.find(c => String(c.id) === classId) : null;
      if (!classData) {
        return { status: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Clase no encontrada' }) };
      }

      const summary = await loadJson(CONTAINER_SUMMARIES, `${classId}.json`);
      const validated = classData.summaryReady === true || summary?.validated === true;
      if (!validated) {
        return { status: 409, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'La clase no tiene un resumen validado para publicar.' }) };
      }

      const result = await dispatchClassSummaryNotification({
        subjectId,
        classData,
        origin: 'publish-now-manual',
      });

      context.log(`[publish-class-summary-now] class=${classId} subject=${subjectId} dispatched=${result.dispatched} recipients=${result.recipientCount || 0}`);
      return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true, ...result }) };
    } catch (err) {
      context.error(`[publish-class-summary-now] class=${classId} error=${err.message}`);
      return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `Error al publicar: ${err.message}` }) };
    }
  })),
});
