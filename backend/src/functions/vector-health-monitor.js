import { app } from '@azure/functions';
import { withCorrelationTimer } from '../middleware/with-correlation.js';
import { getIndexStats } from '../services/vector-store.js';
import { saveJson, loadJson } from '../services/storage.js';
import { trackVectorIndexAnomalyAlert } from '../services/telemetry.js';

const MONITOR_STATE_CONTAINER = 'monitor-state';
const DEDUP_BLOB = 'vector-alert-dedup.json';
const BASELINE_BLOB = 'vector-baseline.json';
const EWA_ALPHA = 0.3;

function getEnv(key, fallback) {
    return process.env[key] ?? fallback;
}

function getThresholds() {
    const raw = {
        fullnessThreshold: parseFloat(getEnv('VECTOR_HEALTH_FULLNESS_THRESHOLD', '0.80')),
        growthSpikeMultiplier: parseFloat(getEnv('VECTOR_HEALTH_GROWTH_SPIKE_MULTIPLIER', '3')),
        dedupWindowMinutes: parseInt(getEnv('VECTOR_HEALTH_DEDUP_WINDOW_MINUTES', '60'), 10),
    };

    const validated = {};
    let valid = true;
    if (!Number.isFinite(raw.fullnessThreshold) || raw.fullnessThreshold < 0 || raw.fullnessThreshold > 1) {
        console.warn('[VectorHealthMonitor] Invalid VECTOR_HEALTH_FULLNESS_THRESHOLD, using default 0.80');
        validated.fullnessThreshold = 0.80;
        valid = false;
    } else {
        validated.fullnessThreshold = raw.fullnessThreshold;
    }
    if (!Number.isFinite(raw.growthSpikeMultiplier) || raw.growthSpikeMultiplier < 1) {
        console.warn('[VectorHealthMonitor] Invalid VECTOR_HEALTH_GROWTH_SPIKE_MULTIPLIER, using default 3');
        validated.growthSpikeMultiplier = 3;
        valid = false;
    } else {
        validated.growthSpikeMultiplier = raw.growthSpikeMultiplier;
    }
    if (!Number.isFinite(raw.dedupWindowMinutes) || raw.dedupWindowMinutes < 1) {
        console.warn('[VectorHealthMonitor] Invalid VECTOR_HEALTH_DEDUP_WINDOW_MINUTES, using default 60');
        validated.dedupWindowMinutes = 60;
        valid = false;
    } else {
        validated.dedupWindowMinutes = raw.dedupWindowMinutes;
    }

    if (!valid) {
        console.warn('[VectorHealthMonitor] One or more threshold env vars had invalid values, defaults applied');
    }
    return validated;
}

async function loadDedupState() {
    try {
        return await loadJson(MONITOR_STATE_CONTAINER, DEDUP_BLOB) || {};
    } catch (err) {
        console.warn('[VectorHealthMonitor] Failed to load dedup state, starting fresh:', err.message);
        return {};
    }
}

async function saveDedupState(state) {
    try {
        await saveJson(MONITOR_STATE_CONTAINER, DEDUP_BLOB, state);
    } catch (err) {
        console.warn('[VectorHealthMonitor] Failed to save dedup state:', err.message);
    }
}

async function loadBaseline() {
    try {
        return await loadJson(MONITOR_STATE_CONTAINER, BASELINE_BLOB) || null;
    } catch (err) {
        console.warn('[VectorHealthMonitor] Failed to load baseline, will recreate:', err.message);
        return null;
    }
}

async function saveBaseline(baseline) {
    try {
        await saveJson(MONITOR_STATE_CONTAINER, BASELINE_BLOB, baseline);
    } catch (err) {
        console.warn('[VectorHealthMonitor] Failed to save baseline:', err.message);
    }
}

function isWithinDedupWindow(lastAlertedAt, dedupWindowMinutes) {
    if (!lastAlertedAt) return false;
    const last = new Date(lastAlertedAt).getTime();
    if (Number.isNaN(last)) return false;
    const now = Date.now();
    return (now - last) < dedupWindowMinutes * 60 * 1000;
}

function computeEwma(current, previous, alpha) {
    const prev = (previous !== null && previous !== undefined) ? previous : current;
    return alpha * current + (1 - alpha) * prev;
}

function isValidBaseline(baseline) {
    if (!baseline) return false;
    return Number.isFinite(baseline.vectorCount)
        && typeof baseline.recordedAt === 'string'
        && !Number.isNaN(new Date(baseline.recordedAt).getTime());
}

app.timer('vector-health-monitor', {
    schedule: getEnv('VECTOR_HEALTH_ALERT_CRON', '0 */15 * * * *'),
    handler: withCorrelationTimer(async (myTimer, context) => {
        const startMs = Date.now();
        const indexName = process.env.PINECONE_INDEX_NAME || 'unknown';
        const thresholds = getThresholds();

        context.log(`[VectorHealthMonitor] Tick at ${new Date().toISOString()}`);

        let stats;
        try {
            stats = await getIndexStats();
        } catch (err) {
            context.log('[VectorHealthMonitor] [ERROR] Failed to fetch index stats:', err.message);
            const dedupState = await loadDedupState();
            const lastAlerted = dedupState.connectivity?.lastAlertedAt;
            if (!isWithinDedupWindow(lastAlerted, thresholds.dedupWindowMinutes)) {
                await trackVectorIndexAnomalyAlert({
                    alertType: 'connectivity',
                    indexName,
                    observedValue: 0,
                    threshold: 0,
                    dedupWindowMinutes: thresholds.dedupWindowMinutes,
                    errorMessage: err.message,
                });
                dedupState.connectivity = { lastAlertedAt: new Date().toISOString(), observedValue: 0 };
                await saveDedupState(dedupState);
            }
            return;
        }

        const fullness = stats.indexFullness;
        const vectorCount = stats.totalVectorCount;
        const now = new Date().toISOString();

        const dedupState = await loadDedupState();

        if (fullness > thresholds.fullnessThreshold) {
            const lastAlerted = dedupState.fullness?.lastAlertedAt;
            if (!isWithinDedupWindow(lastAlerted, thresholds.dedupWindowMinutes)) {
                context.log(`[VectorHealthMonitor] Fullness breach: ${(fullness * 100).toFixed(1)}% > ${(thresholds.fullnessThreshold * 100).toFixed(1)}%`);
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

        const rawBaseline = await loadBaseline();
        if (isValidBaseline(rawBaseline)) {
            const hoursSinceLastRun = (Date.now() - new Date(rawBaseline.recordedAt).getTime()) / (1000 * 60 * 60);
            if (hoursSinceLastRun > 0) {
                const dailyGrowth = ((vectorCount - rawBaseline.vectorCount) / hoursSinceLastRun) * 24;
                const rollingAvg = rawBaseline.rollingAvgDailyGrowth || 0;
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
                await saveBaseline({
                    vectorCount,
                    recordedAt: now,
                    rollingAvgDailyGrowth: Math.round(newRollingAvg),
                });
            } else {
                await saveBaseline({ ...rawBaseline, recordedAt: now });
            }
        } else {
            context.log('[VectorHealthMonitor] No valid baseline found — creating initial baseline, deferring growth evaluation');
            await saveBaseline({
                vectorCount,
                recordedAt: now,
                rollingAvgDailyGrowth: 0,
            });
        }

        await saveDedupState(dedupState);

        const elapsed = Date.now() - startMs;
        context.log(`[VectorHealthMonitor] Run complete in ${elapsed}ms | vectors: ${vectorCount} | fullness: ${(fullness * 100).toFixed(1)}%`);
    }),
});
