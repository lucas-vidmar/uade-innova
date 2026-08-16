/**
 * telemetry.quarantine-payload.test.js
 *
 * Ejercita el path REAL de construccion del evento de trackVectorQuarantineRun
 * (sanitizacion de reason keys, clamp de measurements, truncacion de
 * errorMessage, client.trackEvent). Corre en su propio proceso con
 * APPLICATIONINSIGHTS_CONNECTION_STRING seteado y un client fake via
 * mock.module('applicationinsights') (patch de review #17).
 */
import { test, mock } from 'node:test';
import assert from 'node:assert';

process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = 'InstrumentationKey=test-fake-key';

const trackEvent = mock.fn();
const trackDependency = mock.fn();
const flush = mock.fn(async () => {});

const chainable = {
    setAutoCollectRequests: () => chainable,
    setAutoCollectDependencies: () => chainable,
    setAutoCollectExceptions: () => chainable,
    start: () => {},
};

mock.module('applicationinsights', {
    defaultExport: {
        setup: () => chainable,
        defaultClient: { trackEvent, trackDependency, flush },
    },
});

const { trackVectorQuarantineRun } = await import('../services/telemetry.js');

test('trackVectorQuarantineRun builds a full trackEvent payload (sanitized reasons, clamped measurements, truncated errorMessage)', async () => {
    trackEvent.mock.resetCalls();

    const longMessage = 'x'.repeat(700);
    await trackVectorQuarantineRun({
        runId: 'run-abc',
        mode: 'quarantine',
        scanned: 10,
        clean: 7,
        quarantined: 2,
        unresolvable: 1,
        failed: 1,
        quarantineReasons: { 'subjectId-mismatch': 2, 'classId-mismatch': 1, 'no-authoritative-material': 1 },
        durationMs: 1500,
        success: false,
        errorCategory: 'QUARANTINE_ERROR',
        errorMessage: longMessage,
        chunkCount: -5,
    });

    assert.strictEqual(trackEvent.mock.callCount(), 1);
    const event = trackEvent.mock.calls[0].arguments[0];

    assert.strictEqual(event.name, 'VectorQuarantineRun');
    assert.strictEqual(event.properties.runId, 'run-abc');
    assert.strictEqual(event.properties.mode, 'quarantine');
    assert.strictEqual(event.properties.success, 'false');
    assert.strictEqual(event.properties.errorCategory, 'QUARANTINE_ERROR');
    // errorMessage truncado a 500 chars
    assert.strictEqual(event.properties.errorMessage.length, 500);
    // Reason keys sanitizadas y contadas
    assert.strictEqual(event.properties['reason_subjectId-mismatch'], 2);
    assert.strictEqual(event.properties['reason_classId-mismatch'], 1);
    assert.strictEqual(event.properties['reason_no-authoritative-material'], 1);

    // Measurements clamp: negativos a 0, resto como viene
    assert.strictEqual(event.measurements.scanned, 10);
    assert.strictEqual(event.measurements.clean, 7);
    assert.strictEqual(event.measurements.quarantined, 2);
    assert.strictEqual(event.measurements.unresolvable, 1);
    assert.strictEqual(event.measurements.failed, 1);
    assert.strictEqual(event.measurements.chunkCount, 0, 'chunkCount negativo clamp a 0');
    assert.strictEqual(event.measurements.durationMs, 1500);
});

test('trackVectorQuarantineRun success path emits success:"true" and reindex materialId/chunkCount', async () => {
    trackEvent.mock.resetCalls();

    await trackVectorQuarantineRun({
        runId: 'run-2',
        mode: 'reindex',
        materialId: 'mat-1',
        chunkCount: 42,
        durationMs: 800,
        success: true,
    });

    const event = trackEvent.mock.calls[0].arguments[0];
    assert.strictEqual(event.name, 'VectorQuarantineRun');
    assert.strictEqual(event.properties.mode, 'reindex');
    assert.strictEqual(event.properties.materialId, 'mat-1');
    assert.strictEqual(event.properties.success, 'true');
    assert.strictEqual(event.measurements.chunkCount, 42);
});
