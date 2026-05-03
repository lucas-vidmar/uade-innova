import { test, mock } from 'node:test';
import assert from 'node:assert';
import { Readable } from 'node:stream';

// Mock dependencies
const openaiMocks = {
    generateEmbedding: mock.fn(async () => ({
        embedding: [0.1, 0.2, 0.3],
        usage: { total_tokens: 5 }
    })),
    chatCompletion: mock.fn(async (messages, stream) => {
        if (!stream) return { content: 'sync', usage: { total_tokens: 10 } };
        
        // Mock async iterable for streaming
        return (async function* () {
            yield { choices: [{ delta: { content: 'Part ' } }] };
            yield { choices: [{ delta: { content: '1' } }] };
            yield { usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } };
        })();
    })
};

const vectorStoreMocks = {
    querySimilar: mock.fn(async () => [
        {
            score: 0.9,
            metadata: {
                sourceFilename: 'clase1.pdf',
                text: 'Context text',
                materialType: 'pdf',
                classIds: ['class1'],
                chunkIndex: 0
            }
        }
    ]),
};

const storageMocks = {
    saveJson: mock.fn(async () => true),
    saveMetricsToTable: mock.fn(async () => true),
    getTableClient: mock.fn(() => ({
        createTable: mock.fn(async () => {}),
        listEntities: mock.fn(() => ({
            [Symbol.asyncIterator]: async function* () { yield* []; }
        })),
        upsertEntity: mock.fn(async () => {}),
        getEntity: mock.fn(async () => ({})),
        deleteEntity: mock.fn(async () => {})
    }))
};

const promptsMocks = {
    getShadowPrompt: mock.fn(() => ({ id: 'v1', content: 'System Prompt' }))
};

const authUtilsMocks = {
    validateFrontDoorId: mock.fn(() => true),
    parseClientPrincipal: mock.fn(() => ({ oid: 'user-1' })),
    getAuthenticatedUser: mock.fn(() => ({ id: 'user-1', roles: ['Alumno'] })),
};

const telemetryMocks = {
    trackRAGInteraction: mock.fn(async () => {}),
};

mock.module('../services/ai.js', { namedExports: openaiMocks });
mock.module('../services/vector-store.js', { namedExports: vectorStoreMocks });
mock.module('../services/storage.js', { namedExports: storageMocks });
mock.module('../services/prompts.js', { namedExports: promptsMocks });
mock.module('../services/auth-utils.js', { namedExports: authUtilsMocks });
mock.module('../services/telemetry.js', { namedExports: telemetryMocks });

let capturedHandler;
mock.module('@azure/functions', {
    namedExports: {
        app: {
            http: (name, options) => {
                if (name === 'rag-query') capturedHandler = options.handler;
            }
        }
    }
});

await import('./rag-query.js');

test('rag-query should stream SSE when stream=true', async (t) => {
    telemetryMocks.trackRAGInteraction.mock.resetCalls();

    const mockContext = {
        log: mock.fn(),
        error: mock.fn()
    };

    const mockRequest = {
        json: async () => ({
            question: 'Streaming test?',
            subjectId: 'materia1',
            stream: true
        }),
        user: { id: 'test-user' },
        headers: { get: () => 'test-header' }
    };

    const response = await capturedHandler(mockRequest, mockContext);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers['Content-Type'], 'text/event-stream');
    assert.ok(response.body instanceof ReadableStream, 'Body should be a ReadableStream');

    // Read the stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let events = [];

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        events.push(chunk);
    }

    const fullOutput = events.join('');
    
    // Verify SSE structure
    assert.ok(fullOutput.includes('event: metadata'), 'Should have metadata event');
    assert.ok(fullOutput.includes('event: delta'), 'Should have delta events');
    assert.ok(fullOutput.includes('event: done'), 'Should have done event');
    assert.ok(fullOutput.includes('"content":"Part "'), 'Should contain first chunk');
    assert.ok(fullOutput.includes('"content":"1"'), 'Should contain second chunk');
    assert.ok(fullOutput.includes('"answer":"Part 1"'), 'Should contain final answer in done event');

    assert.ok(telemetryMocks.trackRAGInteraction.mock.callCount() >= 1, 'Should emit RAG telemetry in stream mode');
    const telemetryPayload = telemetryMocks.trackRAGInteraction.mock.calls.at(-1).arguments[0];
    assert.strictEqual(typeof telemetryPayload.ttftMs, 'number', 'Should include numeric ttftMs');
    assert.ok(telemetryPayload.ttftMs >= 0, 'ttftMs should be non-negative');
    assert.ok(Boolean(telemetryPayload.firstTokenAt), 'Should include firstTokenAt timestamp');
});

test('rag-query stream should rewrite follow-up question before retrieval', async () => {
    openaiMocks.generateEmbedding.mock.resetCalls();
    openaiMocks.chatCompletion.mock.resetCalls();

    openaiMocks.chatCompletion.mock.mockImplementation(async (messages, stream) => {
        const systemContent = messages?.[0]?.content || '';
        if (!stream && systemContent.includes('Reescribe la ultima pregunta del estudiante')) {
            return {
                content: '¿Por que es importante la arquitectura hexagonal?',
                usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 }
            };
        }
        if (!stream) return { content: 'sync', usage: { total_tokens: 10 } };
        return (async function* () {
            yield { choices: [{ delta: { content: 'Ok' } }] };
            yield { usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 } };
        })();
    });

    const mockContext = {
        log: mock.fn(),
        error: mock.fn()
    };

    const mockRequest = {
        json: async () => ({
            question: '¿Por que es eso importante?',
            subjectId: 'materia1',
            classIds: ['class1'],
            stream: true,
            conversationHistory: [
                { role: 'user', content: '¿Que es la arquitectura hexagonal?' },
                { role: 'assistant', content: 'Un estilo basado en puertos y adaptadores.' },
                { role: 'user', content: '¿Para que sirve?' }
            ]
        }),
        user: { id: 'test-user' },
        headers: { get: () => 'test-header' }
    };

    const response = await capturedHandler(mockRequest, mockContext);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(openaiMocks.generateEmbedding.mock.calls.at(-1).arguments[0], '¿Por que es importante la arquitectura hexagonal?');
});
