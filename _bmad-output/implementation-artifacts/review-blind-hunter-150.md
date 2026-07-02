# Blind Hunter Review — Vector Index Fullness Anomaly Alerts

You are a blind hunter reviewer. You receive ONLY the diff below. No spec, no project context.

Review the following code changes adversarially and report any bugs, security issues, logical flaws, or suspicious patterns.

## Diff

### New file: `backend/src/functions/vector-health-monitor.js`

```js
import { app } from '@azure/functions';
import { getIndexStats } from '../services/vector-store.js';
import { saveJson, loadJson } from '../services/storage.js';
import { trackVectorIndexAnomalyAlert } from '../services/telemetry.js';

const MONITOR_STATE_CONTAINER = 'monitor-state';
const DEDUP_BLOB = 'vector-alert-dedup.json';
const BASELINE_BLOB = 'vector-baseline.json';
const EWA_ALPHA = 0.3;

function getEnv(key, fallback) {
    return process.env[key] || fallback;
}

function getThresholds() {
    return {
        fullnessThreshold: parseFloat(getEnv('VECTOR_HEALTH_FULLNESS_THRESHOLD', '0.80')),
        growthSpikeMultiplier: parseFloat(getEnv('VECTOR_HEALTH_GROWTH_SPIKE_MULTIPLIER', '3')),
        dedupWindowMinutes: parseInt(getEnv('VECTOR_HEALTH_DEDUP_WINDOW_MINUTES', '60'), 10),
    };
}

async function loadDedupState() {
    return await loadJson(MONITOR_STATE_CONTAINER, DEDUP_BLOB) || {};
}

async function saveDedupState(state) {
    await saveJson(MONITOR_STATE_CONTAINER, DEDUP_BLOB, state);
}

async function loadBaseline() {
    return await loadJson(MONITOR_STATE_CONTAINER, BASELINE_BLOB) || null;
}

async function saveBaseline(baseline) {
    await saveJson(MONITOR_STATE_CONTAINER, BASELINE_BLOB, baseline);
}

function isWithinDedupWindow(lastAlertedAt, dedupWindowMinutes) {
    if (!lastAlertedAt) return false;
    const last = new Date(lastAlertedAt).getTime();
    const now = Date.now();
    return (now - last) < dedupWindowMinutes * 60 * 1000;
}

function computeEwma(current, previous, alpha) {
    return alpha * current + (1 - alpha) * (previous || current);
}

app.timer('vector-health-monitor', {
    schedule: getEnv('VECTOR_HEALTH_ALERT_CRON', '0 */15 * * * *'),
    handler: async (myTimer, context) => {
        const startMs = Date.now();
        const indexName = process.env.PINECONE_INDEX_NAME || 'unknown';
        const thresholds = getThresholds();

        context.log(`[VectorHealthMonitor] Tick at ${new Date().toISOString()}`);

        let stats;
        try {
            stats = await getIndexStats();
        } catch (err) {
            context.error('[VectorHealthMonitor] Failed to fetch index stats:', err.message);
            await trackVectorIndexAnomalyAlert({
                alertType: 'connectivity',
                indexName,
                observedValue: 0,
                threshold: 0,
                dedupWindowMinutes: thresholds.dedupWindowMinutes,
                errorMessage: err.message,
            });
            return;
        }

        const fullness = stats.indexFullness;
        const vectorCount = stats.totalVectorCount;
        const now = new Date().toISOString();

        const dedupState = await loadDedupState();

        if (fullness >= thresholds.fullnessThreshold) {
            const lastAlerted = dedupState.fullness?.lastAlertedAt;
            if (!isWithinDedupWindow(lastAlerted, thresholds.dedupWindowMinutes)) {
                context.log(`[VectorHealthMonitor] Fullness breach: ${(fullness * 100).toFixed(1)}% >= ${(thresholds.fullnessThreshold * 100).toFixed(1)}%`);
                await trackVectorIndexAnomalyAlert({
                    alertType: 'fullness',
                    indexName,
                    observedValue: fullness,
                    threshold: thresholds.fullnessThreshold,
                    dedupWindowMinutes: thresholds.dedupWindowMinutes,
                    vectorCount,
                    indexFullness: fullness,
                });
                dedupState.fullness = { lastAlertedAt: now, observedValue: fullness };
            } else {
                context.log(`[VectorHealthMonitor] Fullness breach deduplicated (last alerted at ${lastAlerted})`);
            }
        }

        let baseline = await loadBaseline();
        if (baseline) {
            const hoursSinceLastRun = (Date.now() - new Date(baseline.recordedAt).getTime()) / (1000 * 60 * 60);
            if (hoursSinceLastRun > 0) {
                const dailyGrowth = ((vectorCount - baseline.vectorCount) / hoursSinceLastRun) * 24;
                const rollingAvg = baseline.rollingAvgDailyGrowth || 0;
                const spikeThreshold = rollingAvg * thresholds.growthSpikeMultiplier;

                if (dailyGrowth > spikeThreshold && spikeThreshold > 0) {
                    const lastAlerted = dedupState.growthSpike?.lastAlertedAt;
                    if (!isWithinDedupWindow(lastAlerted, thresholds.dedupWindowMinutes)) {
                        context.log(`[VectorHealthMonitor] Growth spike: ${Math.round(dailyGrowth)} vectors/day vs threshold ${Math.round(spikeThreshold)}`);
                        await trackVectorIndexAnomalyAlert({
                            alertType: 'growthSpike',
                            indexName,
                            observedValue: Math.round(dailyGrowth),
                            threshold: Math.round(spikeThreshold),
                            dedupWindowMinutes: thresholds.dedupWindowMinutes,
                            vectorCount,
                            indexFullness: fullness,
                        });
                        dedupState.growthSpike = { lastAlertedAt: now, observedValue: Math.round(dailyGrowth) };
                    } else {
                        context.log(`[VectorHealthMonitor] Growth spike deduplicated (last alerted at ${lastAlerted})`);
                    }
                }

                const newRollingAvg = computeEwma(Math.max(0, dailyGrowth), rollingAvg, EWA_ALPHA);
                baseline = {
                    vectorCount,
                    recordedAt: now,
                    rollingAvgDailyGrowth: Math.round(newRollingAvg),
                };
            } else {
                baseline.recordedAt = now;
            }
        } else {
            context.log('[VectorHealthMonitor] No baseline found — creating initial baseline, deferring growth evaluation');
            baseline = {
                vectorCount,
                recordedAt: now,
                rollingAvgDailyGrowth: 0,
            };
        }

        await Promise.all([
            saveDedupState(dedupState),
            saveBaseline(baseline),
        ]);

        const elapsed = Date.now() - startMs;
        context.log(`[VectorHealthMonitor] Run complete in ${elapsed}ms | vectors: ${vectorCount} | fullness: ${(fullness * 100).toFixed(1)}%`);
    },
});
```

### Modified files diffs:

**`backend/src/index.js`** — Added import: `import './functions/vector-health-monitor.js';`

**`backend/src/services/telemetry.js`** — Added `trackVectorIndexAnomalyAlert()` function (lines 430-476): emits `VectorIndexAnomalyAlert` event with alertType, indexName, observedValue, threshold, dedupWindowMinutes, vectorCount, indexFullness, errorMessage.

**`infra/modules/functions.bicep`** — Added 4 env vars: `VECTOR_HEALTH_ALERT_CRON` (0 */15 * * * *), `VECTOR_HEALTH_FULLNESS_THRESHOLD` (0.80), `VECTOR_HEALTH_GROWTH_SPIKE_MULTIPLIER` (3), `VECTOR_HEALTH_DEDUP_WINDOW_MINUTES` (60).

**`infra/modules/storage.bicep`** — Added `monitor-state` container with publicAccess: None.
