import { test, mock } from 'node:test';
import assert from 'node:assert';

const authUtilsMocks = {
    validateFrontDoorId: mock.fn(() => true),
};

let trackedEvents = [];
const telemetryMocks = {
    trackPollingEvent: mock.fn((event) => {
        trackedEvents.push(event);
    }),
};

mock.module('../services/auth-utils.js', { namedExports: authUtilsMocks });
mock.module('../services/telemetry.js', { namedExports: telemetryMocks });

const handlers = {};
mock.module('@azure/functions', {
    namedExports: {
        app: {
            http: (name, options) => {
                handlers[name] = options.handler;
            },
        },
    },
});

await import('./polling-telemetry.js');

test('ingest-polling-telemetry returns 400 for invalid JSON', async () => {
    const response = await handlers['ingest-polling-telemetry'](
        {
            json: async () => { throw new Error('Invalid JSON'); },
        },
        { log: { warn: mock.fn() }, error: mock.fn() }
    );
    assert.strictEqual(response.status, 400);
});

test('ingest-polling-telemetry returns 400 for empty events', async () => {
    const response = await handlers['ingest-polling-telemetry'](
        {
            json: async () => ({}),
        },
        { log: { warn: mock.fn() }, error: mock.fn() }
    );
    assert.strictEqual(response.status, 400);
});

test('ingest-polling-telemetry tracks a single event', async () => {
    trackedEvents = [];
    const response = await handlers['ingest-polling-telemetry'](
        {
            json: async () => ({
                events: [{
                    eventType: 'classes_fallback',
                    subjectId: 'arq-software-2026',
                    materialCount: 2,
                    latencyMs: 150,
                }],
            }),
        },
        { log: { warn: mock.fn() }, error: mock.fn() }
    );
    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.tracked, 1);
    assert.strictEqual(telemetryMocks.trackPollingEvent.mock.calls.length, 1);
    const event = telemetryMocks.trackPollingEvent.mock.calls[0].arguments[0];
    assert.strictEqual(event.eventType, 'classes_fallback');
    assert.strictEqual(event.subjectId, 'arq-software-2026');
});

test('ingest-polling-telemetry tracks multiple events', async () => {
    trackedEvents = [];
    const response = await handlers['ingest-polling-telemetry'](
        {
            json: async () => ({
                events: [
                    { eventType: 'material_status_batch_success', subjectId: 's1', materialCount: 3 },
                    { eventType: 'classes_fallback', subjectId: 's2', materialCount: 1 },
                    { eventType: 'polling_error', subjectId: 's3', errorMessage: 'timeout' },
                ],
            }),
        },
        { log: { warn: mock.fn() }, error: mock.fn() }
    );
    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.tracked, 3);
});

test('ingest-polling-telemetry skips unknown event types', async () => {
    trackedEvents = [];
    const warnMock = mock.fn();
    const response = await handlers['ingest-polling-telemetry'](
        {
            json: async () => ({
                events: [
                    { eventType: 'material_status_batch_success', subjectId: 's1' },
                    { eventType: 'unknown_type', subjectId: 's2' },
                ],
            }),
        },
        { log: { warn: warnMock }, error: mock.fn() }
    );
    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.tracked, 1);
});
