/**
 * telemetry.test.js — Unit tests for the App Insights telemetry service (Issue #69)
 *
 * Strategy: We test the no-op behavior (missing APPLICATIONINSIGHTS_CONNECTION_STRING)
 * since that covers the critical path of "never crashes regardless of environment".
 * The module uses a lazy, cached client so we cannot easily re-init between tests;
 * we therefore focus on the externally observable contract rather than internals.
 */
import { test } from 'node:test';
import assert from 'node:assert';

// Ensure connection string is absent so the module initializes in no-op mode
delete process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;

const { trackRAGInteraction, trackUserLogin, trackPollingEvent, trackUnansweredQuery } = await import('../services/telemetry.js');

test('trackVectorQuarantineRun is a no-op when APPLICATIONINSIGHTS_CONNECTION_STRING is not set', async () => {
    const { trackVectorQuarantineRun } = await import('../services/telemetry.js');
    await assert.doesNotReject(() =>
        trackVectorQuarantineRun({
            runId: 'run-1',
            mode: 'quarantine',
            scanned: 100,
            clean: 90,
            quarantined: 8,
            unresolvable: 1,
            failed: 1,
            quarantineReasons: { 'subjectId-mismatch': 5, 'classId-mismatch': 4 },
            durationMs: 1200,
            success: false,
        })
    );
});

test('trackVectorQuarantineRun handles reindex mode and abort categories without throwing', async () => {
    const { trackVectorQuarantineRun } = await import('../services/telemetry.js');
    await assert.doesNotReject(() =>
        trackVectorQuarantineRun({
            runId: 'run-2',
            mode: 'reindex',
            materialId: 'mat-1',
            chunkCount: 42,
            durationMs: 500,
            success: false,
            errorCategory: 'REINDEX_VERIFY_FAILED',
            errorMessage: 'verify mismatch',
        })
    );
});

// ── No-op behavior when connection string is missing ─────────────────────────

test('trackRAGInteraction is a no-op when APPLICATIONINSIGHTS_CONNECTION_STRING is not set', async () => {
    await assert.doesNotReject(() =>
        trackRAGInteraction({
            userId: 'test-user',
            subjectId: 'arq-software-2026',
            promptTokens: 100,
            completionTokens: 200,
            totalTokens: 300,
            durationMs: 1500,
            promptVersion: 'v1',
            interactionId: 'test-interaction-id',
            correlationId: 'abc-123.trace',
        })
    );
});

test('trackRAGInteraction accepts sandbox flags without throwing', async () => {
    await assert.doesNotReject(() =>
        trackRAGInteraction({
            userId: 'doc-001',
            subjectId: 'arq-software-2026',
            promptTokens: 100,
            completionTokens: 200,
            totalTokens: 300,
            durationMs: 1500,
            promptVersion: 'v1',
            interactionId: 'test-sandbox-id',
            correlationId: 'abc-123.trace',
            sandbox: true,
            simulateStudent: true,
        })
    );
});

test('trackUserLogin is a no-op when APPLICATIONINSIGHTS_CONNECTION_STRING is not set', async () => {
    await assert.doesNotReject(() =>
        trackUserLogin({
            userId: 'test-user',
            roles: ['Alumno'],
        })
    );
});

test('trackUnansweredQuery is a no-op and does not throw without Azure config (#221)', async () => {
    await assert.doesNotReject(() =>
        trackUnansweredQuery({
            question: '¿Qué es la arquitectura hexagonal?',
            rewrittenQuestion: 'arquitectura hexagonal',
            reason: 'no_context',
            subjectId: 'arq-software-2026',
            userId: 'alu-001',
            classIds: ['class-01'],
            correlationId: 'test-corr',
            sourcesCount: 0,
        })
    );
});

test('trackUnansweredQuery handles all refusal reasons without throwing', async () => {
    for (const reason of ['no_context', 'empty_answer', 'refusal_answer', 'safety_blocked']) {
        await assert.doesNotReject(() =>
            trackUnansweredQuery({
                question: 'pregunta de prueba',
                reason,
                subjectId: 'arq-software-2026',
                sourcesCount: 2,
            })
        );
    }
});

// ── Edge cases: missing / partial arguments ───────────────────────────────────

test('trackRAGInteraction handles missing userId gracefully (defaults to anonymous)', async () => {
    await assert.doesNotReject(() =>
        trackRAGInteraction({
            subjectId: 'diseno-sistemas-2026',
            totalTokens: 0,
            durationMs: 0,
        })
    );
});

test('trackRAGInteraction handles all-zero token counts without throwing', async () => {
    await assert.doesNotReject(() =>
        trackRAGInteraction({
            userId: 'user-001',
            subjectId: 'arq-software-2026',
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            durationMs: 0,
            promptVersion: 'v1',
        })
    );
});

test('trackUserLogin handles empty roles array without throwing', async () => {
    await assert.doesNotReject(() =>
        trackUserLogin({
            userId: 'user-002',
            roles: [],
        })
    );
});

test('trackUserLogin handles missing roles property without throwing', async () => {
    await assert.doesNotReject(() =>
        trackUserLogin({
            userId: 'user-003',
        })
    );
});

// ── PollingEvent (Issue #108) ───────────────────────────────────────

test('trackPollingEvent is a no-op when APPLICATIONINSIGHTS_CONNECTION_STRING is not set', async () => {
    await assert.doesNotReject(() =>
        trackPollingEvent({
            eventType: 'material_status_batch_success',
            subjectId: 'arq-software-2026',
            materialCount: 5,
            latencyMs: 120,
        })
    );
});

test('trackPollingEvent handles all event types without throwing', async () => {
    const types = [
        'material_status_batch_success',
        'material_status_batch_get_success',
        'material_status_single_success',
        'classes_fallback',
        'per_item_fallback',
        'polling_error',
    ];
    for (const eventType of types) {
        await assert.doesNotReject(() =>
            trackPollingEvent({
                eventType,
                subjectId: 'arq-software-2026',
                materialCount: 3,
                latencyMs: 200,
                errorMessage: eventType === 'polling_error' ? 'Something went wrong' : undefined,
            })
        );
    }
});

test('trackPollingEvent handles missing subjectId gracefully', async () => {
    await assert.doesNotReject(() =>
        trackPollingEvent({
            eventType: 'classes_fallback',
            materialCount: 1,
        })
    );
});
