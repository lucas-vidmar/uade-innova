import { test, mock } from 'node:test';
import assert from 'node:assert';

// Define mocks before importing the function under test
const openaiMocks = {
    generateEmbedding: mock.fn(async () => ({
        embedding: [0.1, 0.2, 0.3],
        usage: { total_tokens: 5 }
    })),
    getChatModelName: mock.fn(() => 'deepseek-v4-flash'),
    getModelDisplayName: mock.fn((name) => name || 'deepseek-v4-flash'),
    resolveModelForTask: mock.fn(async () => 'deepseek-v4-flash'),
    getChatModelNameForTask: mock.fn(async () => 'deepseek-v4-flash'),
    isDeepSeekModel: mock.fn(() => true),
    getClientForModel: mock.fn(() => null),
    chatCompletion: mock.fn(async () => ({ 
        content: 'Respuesta simulada.',
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
    }))
};

const vectorStoreMocks = {
    querySimilar: mock.fn(async (embedding, filter, topK) => {
        if (filter?.materialType?.$eq === 'verified-answer') return [];
        return [
            {
                score: 0.9,
                id: 'test-chunk-0',
                metadata: {
                    sourceFilename: 'clase1.pdf',
                    text: 'Contenido',
                    materialType: 'notes',
                    materialPriority: 'primary',
                    classIds: ['class1'],
                    chunkIndex: 0
                }
            }
        ];
    })
};

const storageMocks = {
    saveJson: mock.fn(async () => true),
    loadJson: mock.fn(async () => null),
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

const authUtilsMocks = {
    validateFrontDoorId: mock.fn(() => true),
    setStashedIdentity: mock.fn(() => {}),
    parseClientPrincipal: mock.fn(() => ({ oid: 'test-user-oid', userRoles: ['Alumno'] })),
    getAuthenticatedUser: mock.fn(() => ({ userId: 'test-user-oid', sanitizedId: 'test-user-oid' })),
};

const telemetryMocks = {
    trackRAGInteraction: mock.fn(async () => {}),
    trackRAGError: mock.fn(async () => {}),
    trackUnansweredQuery: mock.fn(async () => {}),
};

const stateStoreMocks = {
    getEnrollment: mock.fn(async () => ({ status: 'active', role: 'student' })),
    getConsentStatus: mock.fn(async () => true),
    listMaterialsBySubject: mock.fn(async () => []),
    listReviewedCorrections: mock.fn(async () => []),
};

const promptsMocks = {
    resolveRagPrompt: mock.fn(async () => ({ id: 'test-prompt', content: 'System prompt', source: 'active' })),
    getActivePrompt: mock.fn(() => ({ id: 'test-prompt', content: 'System prompt' })),
};

const correlationMocks = {
    resolveCorrelationId: mock.fn(() => 'test-correlation-id'),
    resolveTraceContext: mock.fn(() => ({ traceparent: '00-trace-id-span-id-01', tracestate: null, traceId: 'trace-id', spanId: 'span-id' })),
    buildDependencyHeaders: mock.fn(() => ({})),
    withCorrelationResponseHeaders: mock.fn((cid, headers) => headers || {}),
    generateCorrelationId: mock.fn(() => 'test-correlation-id'),
};

// Mock dependencies
mock.module('../services/ai.js', { namedExports: openaiMocks });
mock.module('../services/vector-store.js', { namedExports: vectorStoreMocks });
mock.module('../services/storage.js', { namedExports: storageMocks });
mock.module('../services/auth-utils.js', { namedExports: authUtilsMocks });
mock.module('../services/telemetry.js', { namedExports: telemetryMocks });
mock.module('../services/state-store.js', { namedExports: stateStoreMocks });
mock.module('../services/prompts.js', { namedExports: promptsMocks });
mock.module('../services/correlation.js', { namedExports: correlationMocks });

// Mock @azure/functions to capture the handler
let capturedHandler;
mock.module('@azure/functions', {
    namedExports: {
        app: {
            http: (name, options) => {
                if (name === 'rag-query') {
                    capturedHandler = options.handler;
                }
            }
        }
    }
});

// Now import the function under test
await import('../functions/rag-query.js');

function mockContext() {
    return { log: mock.fn(), error: mock.fn(), warn: mock.fn() };
}

function mockRequest(body) {
    return {
        json: async () => body,
        headers: {}
    };
}

// ============================================================================
// Existing tests (preserved, updated for new output)
// ============================================================================

test('RAG Filter: should ALWAYS include subjectId: { $eq: subjectId }', async () => {
    vectorStoreMocks.querySimilar.mock.resetCalls();
    const subjectId = 'math-101';

    await capturedHandler(
        mockRequest({ question: 'test', subjectId, classIds: ['class1'] }),
        mockContext()
    );

    const filter = vectorStoreMocks.querySimilar.mock.calls[1].arguments[1];
    assert.strictEqual(filter.subjectId.$eq, subjectId);
});

// NOTE: With single-class exact-match, classIds with 1 element now use classId.$eq instead of classIds.$in
// This test originally tested classIds.$in with 2 items; we use 2 items to maintain backward-compat
test('RAG Filter: should include $or with classIds.$in and bibliography when multiple classIds', async () => {
    vectorStoreMocks.querySimilar.mock.resetCalls();
    const subjectId = 'math-101';
    const classIds = ['class1', 'class2'];

    await capturedHandler(
        mockRequest({ question: 'test', subjectId, classIds }),
        mockContext()
    );

    const filter = vectorStoreMocks.querySimilar.mock.calls[1].arguments[1];
    assert.ok(filter.$or);
    assert.deepStrictEqual(filter.$or, [
        { classIds: { $in: classIds } },
        { materialType: { $eq: 'bibliography' } }
    ]);
});

test('RAG Filter: should simplify to ONLY subjectId when classIds is ["all"]', async () => {
    vectorStoreMocks.querySimilar.mock.resetCalls();
    const subjectId = 'math-101';

    await capturedHandler(
        mockRequest({ question: 'test', subjectId, classIds: ['all'] }),
        mockContext()
    );

    const filter = vectorStoreMocks.querySimilar.mock.calls[1].arguments[1];
    assert.strictEqual(filter.subjectId.$eq, subjectId);
    assert.strictEqual(filter.$or, undefined);
});

test('RAG Filter: should simplify to ONLY subjectId when classIds is empty', async () => {
    vectorStoreMocks.querySimilar.mock.resetCalls();
    const subjectId = 'math-101';

    await capturedHandler(
        mockRequest({ question: 'test', subjectId, classIds: [] }),
        mockContext()
    );

    const filter = vectorStoreMocks.querySimilar.mock.calls[1].arguments[1];
    assert.strictEqual(filter.subjectId.$eq, subjectId);
    assert.strictEqual(filter.$or, undefined);
});

test('RAG Filter: should simplify to ONLY subjectId when classIds is null', async () => {
    vectorStoreMocks.querySimilar.mock.resetCalls();
    const subjectId = 'math-101';

    await capturedHandler(
        mockRequest({ question: 'test', subjectId, classIds: null }),
        mockContext()
    );

    const filter = vectorStoreMocks.querySimilar.mock.calls[1].arguments[1];
    assert.strictEqual(filter.subjectId.$eq, subjectId);
    assert.strictEqual(filter.$or, undefined);
});

test('RAG Filter: cross-contamination prevention - ensure subjectId is strictly enforced', async () => {
    vectorStoreMocks.querySimilar.mock.resetCalls();
    const subjectId = 'math-101';

    await capturedHandler(
        mockRequest({ question: 'test', subjectId, classIds: ['class-from-another-subject'] }),
        mockContext()
    );

    const filter = vectorStoreMocks.querySimilar.mock.calls[1].arguments[1];
    assert.strictEqual(filter.subjectId.$eq, subjectId);
    const topLevelKeys = Object.keys(filter);
    assert.ok(topLevelKeys.includes('subjectId'));
    for (const key of topLevelKeys) {
        assert.ok(['subjectId', '$or', 'quarantined'].includes(key), `Unexpected top-level filter key: ${key}`);
    }
});

// ============================================================================
// NEW tests — exact classId filter path (Story 2.160)
// ============================================================================

test('Exact classId: single class uses classId.$eq in filter', async () => {
    vectorStoreMocks.querySimilar.mock.resetCalls();
    const subjectId = 'math-101';
    const classIds = ['class-05'];

    await capturedHandler(
        mockRequest({ question: 'test', subjectId, classIds }),
        mockContext()
    );

    const filter = vectorStoreMocks.querySimilar.mock.calls[1].arguments[1];
    // Single class should use exact classId match
    assert.strictEqual(filter.subjectId.$eq, subjectId);
    assert.ok(filter.$or, 'should have $or clause for exact classId + bibliography');
    const classFilter = filter.$or.find(f => f.classId !== undefined);
    assert.ok(classFilter, 'should have classId filter');
    assert.deepStrictEqual(classFilter.classId, { $eq: 'class-05' });
});

test('Exact classId: multi-class uses classIds.$in in filter (backward-compat)', async () => {
    vectorStoreMocks.querySimilar.mock.resetCalls();
    const subjectId = 'math-101';
    const classIds = ['class-05', 'class-06'];

    await capturedHandler(
        mockRequest({ question: 'test', subjectId, classIds }),
        mockContext()
    );

    const filter = vectorStoreMocks.querySimilar.mock.calls[1].arguments[1];
    assert.ok(filter.$or);
    const classFilter = filter.$or.find(f => f.classIds !== undefined);
    assert.ok(classFilter, 'should have classIds filter for multi-class');
    assert.deepStrictEqual(classFilter.classIds, { $in: classIds });
    // Confirm classId.$eq is NOT present for multi-class
    const exactFilter = filter.$or.find(f => f.classId !== undefined);
    assert.strictEqual(exactFilter, undefined);
});

test('Exact classId: bibliography fallback present by default (single class)', async () => {
    vectorStoreMocks.querySimilar.mock.resetCalls();
    const subjectId = 'math-101';

    await capturedHandler(
        mockRequest({ question: 'test', subjectId, classIds: ['class-05'] }),
        mockContext()
    );

    const filter = vectorStoreMocks.querySimilar.mock.calls[1].arguments[1];
    const bibFilter = filter.$or.find(f => f.materialType && f.materialType.$eq === 'bibliography');
    assert.ok(bibFilter, 'bibliography fallback should be present by default');
});

test('Exact classId: bibliography fallback present by default (multi class)', async () => {
    vectorStoreMocks.querySimilar.mock.resetCalls();
    const subjectId = 'math-101';

    await capturedHandler(
        mockRequest({ question: 'test', subjectId, classIds: ['class-05', 'class-06'] }),
        mockContext()
    );

    const filter = vectorStoreMocks.querySimilar.mock.calls[1].arguments[1];
    const bibFilter = filter.$or.find(f => f.materialType && f.materialType.$eq === 'bibliography');
    assert.ok(bibFilter, 'bibliography fallback should be present for multi-class');
});

test('Exact classId: bibliography fallback omitted when RAG_DISABLE_BIBLIOGRAPHY_FALLBACK=true', async () => {
    vectorStoreMocks.querySimilar.mock.resetCalls();

    const prev = process.env.RAG_DISABLE_BIBLIOGRAPHY_FALLBACK;
    process.env.RAG_DISABLE_BIBLIOGRAPHY_FALLBACK = 'true';

    try {
        await capturedHandler(
            mockRequest({ question: 'test', subjectId: 'math-101', classIds: ['class-05'] }),
            mockContext()
        );

        const filter = vectorStoreMocks.querySimilar.mock.calls[1].arguments[1];
        // $or should exist (at least for the classId filter)
        assert.ok(filter.$or, 'should have $or clause');
        // No bibliography filter in $or
        const bibFilter = filter.$or.find(f => f.materialType && f.materialType.$eq === 'bibliography');
        assert.strictEqual(bibFilter, undefined, 'bibliography fallback should be absent');
    } finally {
        if (prev !== undefined) process.env.RAG_DISABLE_BIBLIOGRAPHY_FALLBACK = prev;
        else delete process.env.RAG_DISABLE_BIBLIOGRAPHY_FALLBACK;
    }
});

test('Telemetry: filterType is "exact-classId" for single class', async () => {
    vectorStoreMocks.querySimilar.mock.resetCalls();
    telemetryMocks.trackRAGInteraction.mock.resetCalls();

    await capturedHandler(
        mockRequest({ question: 'telemetry test', subjectId: 'math-101', classIds: ['class-05'] }),
        mockContext()
    );

    const callArgs = telemetryMocks.trackRAGInteraction.mock.calls[0].arguments[0];
    assert.strictEqual(callArgs.filterType, 'exact-classId');
    assert.strictEqual(callArgs.selectedClassCount, 1);
});

test('Telemetry: filterType is "multi-classIds" for multiple classes', async () => {
    vectorStoreMocks.querySimilar.mock.resetCalls();
    telemetryMocks.trackRAGInteraction.mock.resetCalls();

    await capturedHandler(
        mockRequest({ question: 'telemetry test', subjectId: 'math-101', classIds: ['class-05', 'class-06'] }),
        mockContext()
    );

    const callArgs = telemetryMocks.trackRAGInteraction.mock.calls[0].arguments[0];
    assert.strictEqual(callArgs.filterType, 'multi-classIds');
    assert.strictEqual(callArgs.selectedClassCount, 2);
});

test('Telemetry: filterType is "subject-only" when classIds is ["all"]', async () => {
    vectorStoreMocks.querySimilar.mock.resetCalls();
    telemetryMocks.trackRAGInteraction.mock.resetCalls();

    await capturedHandler(
        mockRequest({ question: 'telemetry test', subjectId: 'math-101', classIds: ['all'] }),
        mockContext()
    );

    const callArgs = telemetryMocks.trackRAGInteraction.mock.calls[0].arguments[0];
    assert.strictEqual(callArgs.filterType, 'subject-only');
    assert.strictEqual(callArgs.selectedClassCount, 0);
});

test('Telemetry: filterType is "subject-only" when classIds is null', async () => {
    vectorStoreMocks.querySimilar.mock.resetCalls();
    telemetryMocks.trackRAGInteraction.mock.resetCalls();

    await capturedHandler(
        mockRequest({ question: 'telemetry test', subjectId: 'math-101', classIds: null }),
        mockContext()
    );

    const callArgs = telemetryMocks.trackRAGInteraction.mock.calls[0].arguments[0];
    assert.strictEqual(callArgs.filterType, 'subject-only');
    assert.strictEqual(callArgs.selectedClassCount, 0);
});

test('Telemetry: selectedClassCount deduplicates repeated classIds', async () => {
    vectorStoreMocks.querySimilar.mock.resetCalls();
    telemetryMocks.trackRAGInteraction.mock.resetCalls();

    await capturedHandler(
        mockRequest({ question: 'telemetry test', subjectId: 'math-101', classIds: ['class-05', 'class-05', 'class-06'] }),
        mockContext()
    );

    const callArgs = telemetryMocks.trackRAGInteraction.mock.calls[0].arguments[0];
    assert.strictEqual(callArgs.selectedClassCount, 2);
});

// ============================================================================
// Quarantine exclusion (Story 10.17 / Task 4.1-4.3)
// ============================================================================

test('RAG Filter: quarantined exclusion present in subject-only filter shape', async () => {
    vectorStoreMocks.querySimilar.mock.resetCalls();
    await capturedHandler(
        mockRequest({ question: 'test', subjectId: 'math-101', classIds: ['all'] }),
        mockContext()
    );
    const filter = vectorStoreMocks.querySimilar.mock.calls[1].arguments[1];
    assert.deepStrictEqual(filter.quarantined, { $ne: true });
});

test('RAG Filter: quarantined exclusion present in exact-classId filter shape', async () => {
    vectorStoreMocks.querySimilar.mock.resetCalls();
    await capturedHandler(
        mockRequest({ question: 'test', subjectId: 'math-101', classIds: ['class-05'] }),
        mockContext()
    );
    const filter = vectorStoreMocks.querySimilar.mock.calls[1].arguments[1];
    assert.deepStrictEqual(filter.quarantined, { $ne: true });
    assert.ok(filter.$or);
});

test('RAG Filter: quarantined exclusion present in multi-classIds filter shape', async () => {
    vectorStoreMocks.querySimilar.mock.resetCalls();
    await capturedHandler(
        mockRequest({ question: 'test', subjectId: 'math-101', classIds: ['class-05', 'class-06'] }),
        mockContext()
    );
    const filter = vectorStoreMocks.querySimilar.mock.calls[1].arguments[1];
    assert.deepStrictEqual(filter.quarantined, { $ne: true });
});

test('RAG Filter: verified-answer pre-search filter includes the quarantined exclusion', async () => {
    vectorStoreMocks.querySimilar.mock.resetCalls();
    await capturedHandler(
        mockRequest({ question: 'test', subjectId: 'math-101', classIds: ['class-05'] }),
        mockContext()
    );
    const verifiedFilter = vectorStoreMocks.querySimilar.mock.calls[0].arguments[1];
    assert.strictEqual(verifiedFilter.materialType.$eq, 'verified-answer');
    assert.deepStrictEqual(verifiedFilter.quarantined, { $ne: true });
});

test('RAG Filter: post-filter drops quarantined matches (defense-in-depth)', async () => {
    vectorStoreMocks.querySimilar.mock.resetCalls();
    vectorStoreMocks.querySimilar.mock.mockImplementation(async (embedding, filter) => {
        if (filter?.materialType?.$eq === 'verified-answer') return [];
        return [
            {
                score: 0.95,
                id: 'quarantined-chunk',
                metadata: {
                    sourceFilename: 'leaked.txt',
                    text: 'Contenido filtrado',
                    materialType: 'notes',
                    classIds: ['class1'],
                    chunkIndex: 0,
                    quarantined: true,
                },
            },
        ];
    });

    const response = await capturedHandler(
        mockRequest({ question: 'test', subjectId: 'math-101', classIds: ['class1'] }),
        mockContext()
    );

    const body = JSON.parse(response.body);
    assert.strictEqual(body.answer, 'No encontre informacion sobre eso en los materiales seleccionados.');
    assert.deepStrictEqual(body.sources, []);
});

test('RAG Filter: verified-answer fast path discards a quarantined verifiedMatch (Loopback 1)', async () => {
    vectorStoreMocks.querySimilar.mock.resetCalls();
    vectorStoreMocks.querySimilar.mock.mockImplementation(async (embedding, filter) => {
        if (filter?.materialType?.$eq === 'verified-answer') {
            return [
                {
                    score: 0.99,
                    id: 'verified-1',
                    metadata: {
                        materialType: 'verified-answer',
                        text: 'RESPUESTA VERIFICADA SECRETA',
                        correctedAnswer: 'RESPUESTA VERIFICADA SECRETA',
                        teacherId: 't1',
                        quarantined: true,
                    },
                },
            ];
        }
        return [
            {
                score: 0.9,
                id: 'test-chunk-0',
                metadata: {
                    sourceFilename: 'clase1.pdf',
                    text: 'Contenido',
                    materialType: 'notes',
                    materialPriority: 'primary',
                    classIds: ['class1'],
                    chunkIndex: 0,
                },
            },
        ];
    });

    const response = await capturedHandler(
        mockRequest({ question: 'test', subjectId: 'math-101', classIds: ['class1'] }),
        mockContext()
    );

    const body = JSON.parse(response.body);
    assert.notStrictEqual(body.answer, 'RESPUESTA VERIFICADA SECRETA', 'el fast path no debe devolver una respuesta cuarentenada');
    assert.strictEqual(body.answer, 'Respuesta simulada.');
});
