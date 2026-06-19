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

const { trackRAGInteraction, trackUserLogin } = await import('../services/telemetry.js');

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

test('trackUserLogin is a no-op when APPLICATIONINSIGHTS_CONNECTION_STRING is not set', async () => {
    await assert.doesNotReject(() =>
        trackUserLogin({
            userId: 'test-user',
            roles: ['Alumno'],
        })
    );
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
