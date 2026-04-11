import { app } from '@azure/functions';
import { loadJson, listBlobs } from '../services/storage.js';
import { upsertNotificationForSubject } from '../services/notification-store.js';

const CONTAINER_CLASSES = process.env.AZURE_STORAGE_CONTAINER_CLASSES || 'classes-config';
const CONTAINER_SUMMARIES = 'class-summaries';
const SUBJECTS_BLOB = 'subjects.json';

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
  const subjectIds = await loadSubjectIds();
  let dispatched = 0;

  for (const subjectId of subjectIds) {
    const classes = await loadJson(CONTAINER_CLASSES, `${subjectId}.json`);
    if (!Array.isArray(classes) || classes.length === 0) continue;

    for (const classData of classes) {
      try {
        const shouldDispatch = await shouldDispatchForClass(classData);
        if (!shouldDispatch) continue;

        const classId = String(classData.id);
        await upsertNotificationForSubject(subjectId, {
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

        dispatched += 1;
      } catch (err) {
        context.error(`[post-class-summary-dispatcher] subject=${subjectId} class=${classData?.id || 'unknown'} error=${err.message}`);
      }
    }
  }

  context.log(`[post-class-summary-dispatcher] completed; notifications upserted=${dispatched}`);
  return { dispatched, subjectCount: subjectIds.length };
}

app.timer('post-class-summary-dispatcher', {
  schedule: process.env.POST_CLASS_SUMMARY_TIMER_CRON || '0 */15 * * * *',
  handler: async (_timer, context) => {
    await runPostClassSummaryDispatcher(context);
  },
});
