import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { withCorrelation, withCorrelationTimer } from '../middleware/with-correlation.js';
import { loadJson, listBlobs } from '../services/storage.js';
import { dispatchClassSummaryNotification } from '../services/notification-store.js';
import { isPublished, resolveAssetPublicationState, resolveClassPublicationState } from '../services/publication-state.js';
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

// #368: (subjectId, classId)-scoped read of a derived asset, mirroring the
// #328 helper the student-facing endpoints use (`classes-api.js`). Class AI
// assets live at `{subjectId}/{classId}.json`; the legacy positional key
// `{classId}.json` is only honored when its embedded subjectId matches the
// request (or is absent). Reading the legacy key unconditionally made the
// dispatcher decide on a different document than the one students read.
async function loadScopedSummary(subjectId, classId) {
  const scoped = await loadJson(CONTAINER_SUMMARIES, `${subjectId}/${classId}.json`).catch(() => null);
  if (scoped) return scoped;
  const legacy = await loadJson(CONTAINER_SUMMARIES, `${classId}.json`).catch(() => null);
  if (!legacy) return null;
  if (legacy.subjectId && String(legacy.subjectId) !== String(subjectId)) return null;
  return legacy;
}

async function shouldDispatchForClass(classData, subjectId) {
  if (!classData?.id) return false;
  if (!isPastClassDate(classData.date)) return false;

  // #368: `summaryReady` is publication state kept in the class list blob, not
  // proof that the derived summary exists. Announcing a summary that is not in
  // the student's scope sends the learner to an empty class page.
  const summary = await loadScopedSummary(subjectId, String(classData.id));
  if (!summary) return false;

  // #428: el aviso es consecuencia del estado explícito de publicación, que la
  // clase y su resumen comparten. Sólo se anuncia lo publicado.
  return isPublished(resolveClassPublicationState(classData))
    && isPublished(resolveAssetPublicationState(summary));
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
        const shouldDispatch = await shouldDispatchForClass(classData, subjectId);
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

      // #368: read the derived summary in the same scope students read it, and
      // require it to exist: publishing a summary that is not there announces
      // an empty class.
      const summary = await loadScopedSummary(subjectId, classId);
      // #428: sólo se re-avisa un contenido efectivamente publicado.
      const published = !!summary
        && isPublished(resolveClassPublicationState(classData))
        && isPublished(resolveAssetPublicationState(summary));
      if (!published) {
        return { status: 409, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'La clase no está publicada: no hay un resumen publicado para avisar.' }) };
      }

      const result = await dispatchClassSummaryNotification({
        subjectId,
        classData,
        origin: 'publish-now-manual',
        change: {
          by: classData.publicationChangedBy,
          at: classData.publicationChangedAt,
        },
      });

      context.log(`[publish-class-summary-now] class=${classId} subject=${subjectId} dispatched=${result.dispatched} recipients=${result.recipientCount || 0}`);
      return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true, ...result }) };
    } catch (err) {
      context.error(`[publish-class-summary-now] class=${classId} error=${err.message}`);
      return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `Error al publicar: ${err.message}` }) };
    }
  })),
});
