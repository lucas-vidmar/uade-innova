import { app } from '@azure/functions';
import { withCorrelationTimer } from '../middleware/with-correlation.js';
import { loadJson, listBlobs } from '../services/storage.js';
import { upsertNotificationForSubject } from '../services/notification-store.js';
import { listClassesBySubject, listMaterialsByClass } from '../services/state-store.js';

const CONTAINER_CLASSES = process.env.AZURE_STORAGE_CONTAINER_CLASSES || 'classes-config';
const SUBJECTS_BLOB = 'subjects.json';

function isClassWithin24Hours(classDateStr, now = new Date()) {
  const classDate = new Date(classDateStr);
  if (Number.isNaN(classDate.getTime())) return false;
  const diffMs = classDate.getTime() - now.getTime();
  return diffMs > 0 && diffMs <= 24 * 60 * 60 * 1000;
}

function buildReminderNotification(subjectId, classData, now) {
  const classId = String(classData.id);
  return {
    id: `notif-reminder-${subjectId}-${classId}`,
    type: 'teacher-reminder',
    title: 'Recordatorio: Materiales no cargados',
    message: `La clase "${classData.title || classId}" comienza pronto y aún no tiene materiales cargados.`,
    createdAt: now.toISOString(),
    unread: true,
    targetHash: `#/teacher/class/${classId}`,
    subjectId,
    recipientUserIds: Array.isArray(classData.professorIds) ? classData.professorIds : [],
    origin: 'daily-reminders-timer',
  };
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

export async function runDailyReminders(context = { log: () => {}, error: () => {} }, now = new Date()) {
  const subjectIds = await loadSubjectIds();
  let dispatched = 0;

  for (const subjectId of subjectIds) {
    const classes = await listClassesBySubject(subjectId);
    if (!Array.isArray(classes) || classes.length === 0) continue;

    for (const classData of classes) {
      try {
        if (!classData?.id) continue;
        if (!isClassWithin24Hours(classData.date, now)) continue;

        const materials = await listMaterialsByClass(subjectId, classData.id);
        const hasReadyMaterials = materials.some((m) => m.status === 'ready');

        if (hasReadyMaterials) continue;

        const notification = buildReminderNotification(subjectId, classData, now);
        await upsertNotificationForSubject(subjectId, notification);
        dispatched += 1;
      } catch (err) {
        context.error(`[daily-reminders] subject=${subjectId} class=${classData?.id || 'unknown'} error=${err.message}`);
      }
    }
  }

  context.log(`[daily-reminders] completed; reminders upserted=${dispatched}; subjects=${subjectIds.length}`);
  return { dispatched, subjectCount: subjectIds.length };
}

app.timer('daily-reminders', {
  schedule: process.env.DAILY_REMINDERS_TIMER_CRON || '0 0 8 * * *',
  handler: withCorrelationTimer(async (_timer, context) => {
    await runDailyReminders(context);
  }),
});
