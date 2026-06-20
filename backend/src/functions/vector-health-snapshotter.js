import { app } from '@azure/functions';
import { captureSnapshot, deleteOlderThan } from '../services/vector-health-snapshots.js';

function getEnv(key, fallback) {
    return process.env[key] ?? fallback;
}

app.timer('vector-health-snapshotter', {
    schedule: getEnv('VECTOR_SNAPSHOT_CRON', '0 */15 * * * *'),
    handler: async (myTimer, context) => {
        const startMs = Date.now();
        context.log(`[VectorHealthSnapshotter] Tick at ${new Date().toISOString()}`);

        try {
            const retentionDays = parseInt(getEnv('VECTOR_SNAPSHOT_RETENTION_DAYS', '90'), 10);
            const deleted = Number.isFinite(retentionDays) ? await deleteOlderThan(retentionDays) : 0;
            if (deleted > 0) {
                context.log(`[VectorHealthSnapshotter] Retention cleanup: deleted ${deleted} old snapshots`);
            }
        } catch (err) {
            context.log(`[VectorHealthSnapshotter] [WARN] Retention cleanup failed: ${err.message}`);
        }

        try {
            const snapshot = await captureSnapshot();
            context.log(`[VectorHealthSnapshotter] Snapshot captured: ${snapshot.totalVectorCount} vectors, ${(snapshot.indexFullness * 100).toFixed(1)}% fullness`);
        } catch (err) {
            context.log(`[VectorHealthSnapshotter] [ERROR] Failed to capture snapshot: ${err.message}`);
        }

        const elapsed = Date.now() - startMs;
        context.log(`[VectorHealthSnapshotter] Run complete in ${elapsed}ms`);
    },
});
