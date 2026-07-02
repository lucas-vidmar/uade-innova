import { app } from '@azure/functions';
import { withCorrelationTimer } from '../middleware/with-correlation.js';
import { loadJson, listBlobs } from '../services/storage.js';
import { upsertNotificationForSubject } from '../services/notification-store.js';
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

function notificationIdForClass(subjectId, classId) {
  return `notif-auto-summary-${subjectId}-${classId}`;
}

function summaryMessageForClass(classData) {
  const classLabel = classData?.title || classData?.id || 'Clase';
  return `${classLabel} ya tiene resumen validado.`;
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
        const { retryAttempts: retries, deadLetterWrites: dlWrites } = await upsertNotificationForSubject(subjectId, {
          id: notificationIdForClass(subjectId, classId),
          type: 'summary',
          title: 'Resumen validado por docente',
          message: summaryMessageForClass(classData),
          createdAt: new Date().toISOString(),
          unread: true,
          targetHash: `#/student/class/${classId}`,
          subjectId,
          recipientUserIds: Array.isArray(classData.studentIds) ? classData.studentIds : [],
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
