import { app } from '@azure/functions';
import { withCorrelationTimer } from '../middleware/with-correlation.js';
import { v4 as uuidv4 } from 'uuid';
import { runVectorBackup } from '../services/vector-backup.js';
import { listActiveApprovals } from '../services/backup-approval.js';
import { loadJson, saveJson } from '../services/storage.js';
import { trackVectorBackupRun } from '../services/telemetry.js';

const STATUS_CONTAINER = 'backup-status';
const STATUS_BLOB = 'last-run.json';

async function getLastRunStatus() {
    try {
        return await loadJson(STATUS_CONTAINER, STATUS_BLOB);
    } catch {
        return null;
    }
}

async function saveLastRunStatus(status) {
    await saveJson(STATUS_CONTAINER, STATUS_BLOB, status);
}

export async function runScheduledBackup(context) {
    const runId = uuidv4();
    const startedAt = Date.now();
    let totalVectorCount = 0;
    let mode = 'backup-only';

    context.log(`[VectorBackupScheduler] Starting run ${runId}`);

    try {
        const activeApprovals = await listActiveApprovals();
        const hasCleanupApproval = activeApprovals.length > 0;

        const lastRun = await getLastRunStatus();
        const previousRunFailed = lastRun && lastRun.success === false;

        if (hasCleanupApproval && previousRunFailed) {
            context.log(`[VectorBackupScheduler] Previous backup run (${lastRun?.runId}) failed — blocking cleanup. Running backup-only.`);
            context.error(`[VectorBackupScheduler] VectorBackupCleanupBlocked: cleanup blocked for run ${runId} because previous run ${lastRun?.runId} failed.`);

            await trackVectorBackupRun({
                runId,
                mode: 'backup-only',
                subjectScope: 'all',
                durationMs: 0,
                vectorCount: 0,
                success: true,
            });
        }

        if (hasCleanupApproval && !previousRunFailed) {
            mode = 'backup+cleanup';
            context.log(`[VectorBackupScheduler] Active approvals found: ${activeApprovals.map(a => a.subjectId).join(', ')}`);
            for (const approval of activeApprovals) {
                try {
                    const result = await runVectorBackup({
                        mode: 'backup+cleanup',
                        subjectScope: approval.subjectId,
                    });
                    totalVectorCount += result.vectorCount;
                    context.log(`[VectorBackupScheduler] ${approval.subjectId}: backup+cleanup completed (runId=${result.runId}, vectors=${result.vectorCount}, durationMs=${result.durationMs})`);
                } catch (err) {
                    context.error(`[VectorBackupScheduler] ${approval.subjectId}: cleanup failed — ${err.message}`);
                }
            }
        } else {
            context.log('[VectorBackupScheduler] No active approvals — running backup-only for all vectors.');
            try {
                const result = await runVectorBackup({ mode: 'backup-only' });
                totalVectorCount += result.vectorCount;
                context.log(`[VectorBackupScheduler] backup-only completed (runId=${result.runId}, vectors=${result.vectorCount}, durationMs=${result.durationMs})`);
            } catch (err) {
                context.error(`[VectorBackupScheduler] backup-only failed: ${err.message}`);
                await saveLastRunStatus({
                    runId,
                    mode: 'backup-only',
                    success: false,
                    durationMs: Date.now() - startedAt,
                    vectorCount: 0,
                    completedAt: new Date().toISOString(),
                });
                throw err;
            }
        }

        const durationMs = Date.now() - startedAt;
        await saveLastRunStatus({
            runId,
            mode,
            success: true,
            durationMs,
            vectorCount: totalVectorCount,
            completedAt: new Date().toISOString(),
        });

        context.log(`[VectorBackupScheduler] Run ${runId} completed. mode=${mode}, vectors=${totalVectorCount}, durationMs=${durationMs}`);
        return { runId, mode, vectorCount: totalVectorCount, durationMs };
    } catch (err) {
        const durationMs = Date.now() - startedAt;
        context.error(`[VectorBackupScheduler] Run ${runId} failed: ${err.message}`);
        await saveLastRunStatus({
            runId,
            mode,
            success: false,
            durationMs,
            vectorCount: totalVectorCount,
            completedAt: new Date().toISOString(),
            error: err.message,
        });
        throw err;
    }
}

app.timer('vector-backup-scheduler', {
    schedule: process.env.VECTOR_BACKUP_WINDOW_CRON || '0 0 3 * * *',
    handler: withCorrelationTimer(async (_timer, context) => {
        await runScheduledBackup(context);
    }),
});
