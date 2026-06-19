const operations = [];
const DEFAULT_WINDOW_MINUTES = 5;
const MAX_RECORDS = 10000;

export function recordVectorOperation(durationMs, success) {
    operations.push({ durationMs, success, timestamp: Date.now() });
    const cutoff = Date.now() - DEFAULT_WINDOW_MINUTES * 60 * 1000;
    while (operations.length > 0 && operations[0].timestamp < cutoff) {
        operations.shift();
    }
    if (operations.length > MAX_RECORDS) {
        operations.splice(0, operations.length - MAX_RECORDS);
    }
}

export function getVectorMetrics(windowMinutes) {
    const window = Number.isFinite(windowMinutes) && windowMinutes > 0 ? windowMinutes : DEFAULT_WINDOW_MINUTES;
    const cutoff = Date.now() - window * 60 * 1000;
    const relevant = operations.filter(op => op.timestamp >= cutoff);

    if (relevant.length === 0) {
        return {
            latencyMs: { p50: null, p95: null },
            failureRatio: null,
            sampleCount: 0,
            windowMinutes: window,
        };
    }

    const durations = relevant.map(op => op.durationMs).sort((a, b) => a - b);
    const failures = relevant.filter(op => !op.success).length;

    return {
        latencyMs: { p50: percentile(durations, 0.5), p95: percentile(durations, 0.95) },
        failureRatio: failures / relevant.length,
        sampleCount: relevant.length,
        windowMinutes: window,
    };
}

function percentile(sorted, p) {
    const index = Math.ceil(p * sorted.length) - 1;
    if (index < 0) return sorted[0];
    if (index >= sorted.length) return sorted[sorted.length - 1];
    return sorted[index];
}

export function resetMetrics() {
    operations.length = 0;
}
