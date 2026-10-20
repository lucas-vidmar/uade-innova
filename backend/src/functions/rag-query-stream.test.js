import { test, mock } from 'node:test';
import assert from 'node:assert';
import { Readable } from 'node:stream';

// Mock dependencies
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
    querySimilar: mock.fn(async (embedding, filter, topK) => {
        if (filter?.materialType?.$eq === 'verified-answer') return [];
        return [
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
        ];
    }),
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

const promptsMocks = {
    getActivePrompt: mock.fn(async () => null),
    resolveRagPrompt: mock.fn(async () => ({ id: 'v1', content: 'System Prompt', source: 'active' }))
};

const authUtilsMocks = {
    validateFrontDoorId: mock.fn(() => true),
    setStashedIdentity: mock.fn(() => {}),
    parseClientPrincipal: mock.fn(() => ({ oid: 'user-1', userRoles: ['authenticated', 'Alumno'] })),
    getAuthenticatedUser: mock.fn(() => ({ id: 'user-1', roles: ['Alumno'] })),
    // Mirrors the real hasResolvedIdentity (#481).
    hasResolvedIdentity: mock.fn((user) => {
        if (!user) return false;
        const role = user.role;
        if (!role || role === 'Anonymous' || role === 'Denied') return false;
        const id = user.userId || user.id;
        return Boolean(id) && id !== 'anonymous' && id !== 'pilot-user';
    }),
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
    listClassesBySubject: mock.fn(async () => []),
    // El aviso de integridad del índice (index-integrity-alert) llega a
    // state-store a través de notification-store: la simulación tiene que
    // cubrir la superficie real del módulo o el grafo no instancia.
    getEnrollmentsBySubject: mock.fn(async () => []),
};

mock.module('../services/ai.js', { namedExports: openaiMocks });
mock.module('../services/vector-store.js', { namedExports: vectorStoreMocks });
mock.module('../services/storage.js', { namedExports: storageMocks });
mock.module('../services/prompts.js', { namedExports: promptsMocks });
mock.module('../services/auth-utils.js', { namedExports: authUtilsMocks });
mock.module('../services/telemetry.js', { namedExports: telemetryMocks });
mock.module('../services/state-store.js', { namedExports: stateStoreMocks });

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

const ragQueryModule = await import('./rag-query.js');
const { isAbstentionAnswer } = ragQueryModule;

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

test('rag-query stream should abort cleanly on AbortError', async () => {
    openaiMocks.chatCompletion.mock.resetCalls();
    openaiMocks.generateEmbedding.mock.resetCalls();
    telemetryMocks.trackRAGError.mock.resetCalls();

    // Make chatCompletion throw AbortError on stream call
    openaiMocks.chatCompletion.mock.mockImplementation(async (messages, stream) => {
        if (!stream) return { content: 'sync', usage: { total_tokens: 10 } };
        const abortErr = new Error('The operation was aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
    });

    const mockContext = {
        log: mock.fn(),
        error: mock.fn()
    };

    const mockRequest = {
        json: async () => ({
            question: 'Test abort?',
            subjectId: 'materia1',
            stream: true
        }),
        user: { id: 'test-user' },
        signal: { aborted: false, addEventListener: () => {} }
    };

    const response = await capturedHandler(mockRequest, mockContext);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers['Content-Type'], 'text/event-stream');

    // Read stream to verify clean close (no error event)
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let allText = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        allText += decoder.decode(value);
    }

    // Should NOT contain an error event
    assert.ok(!allText.includes('event: error'), 'Should not emit error SSE event on abort');
    assert.strictEqual(telemetryMocks.trackRAGError.mock.callCount(), 1, 'Should emit exactly one RAG error telemetry event on abort');
});

test('rag-query stream should complete normally with signal present', async () => {
    openaiMocks.chatCompletion.mock.resetCalls();
    openaiMocks.generateEmbedding.mock.resetCalls();

    openaiMocks.chatCompletion.mock.mockImplementation(async (messages, stream) => {
        if (!stream) return { content: 'sync', usage: { total_tokens: 10 } };
        return (async function* () {
            yield { choices: [{ delta: { content: 'Normal ' } }] };
            yield { choices: [{ delta: { content: 'response' } }] };
            yield { usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } };
        })();
    });

    const mockContext = {
        log: mock.fn(),
        error: mock.fn()
    };

    const mockRequest = {
        json: async () => ({
            question: 'Normal test?',
            subjectId: 'materia1',
            stream: true
        }),
        user: { id: 'test-user' },
        signal: { aborted: false }
    };

    const response = await capturedHandler(mockRequest, mockContext);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers['Content-Type'], 'text/event-stream');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let allText = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        allText += decoder.decode(value);
    }

    assert.ok(allText.includes('event: metadata'), 'Should have metadata event');
    assert.ok(allText.includes('event: delta'), 'Should have delta events');
    assert.ok(allText.includes('event: done'), 'Should have done event');
    assert.ok(allText.includes('"answer":"Normal response"'), 'Should contain final answer in done event');
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

test('rag-query should inject bot tone/length preferences block and cap max_tokens when concise (11-5-1)', async () => {
    openaiMocks.generateEmbedding.mock.resetCalls();
    openaiMocks.chatCompletion.mock.resetCalls();

    let capturedSystemContent = '';
    let capturedOptions = null;
    openaiMocks.chatCompletion.mock.mockImplementation(async (messages, stream, options) => {
        const systemContent = messages?.[0]?.content || '';
        if (!stream && systemContent.includes('Reescribe la ultima pregunta del estudiante')) {
            return { content: 'pref test?', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
        }
        if (!stream) {
            capturedSystemContent = systemContent;
            capturedOptions = options;
            return { content: 'sync', usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } };
        }
        return (async function* () {
            yield { choices: [{ delta: { content: 'Ok' } }] };
            yield { usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 } };
        })();
    });

    const mockContext = { log: mock.fn(), error: mock.fn() };

    const mockRequest = {
        json: async () => ({
            question: 'Preferencia test?',
            subjectId: 'materia1',
            classIds: ['class1'],
            stream: false,
            botTone: 'didactic',
            botLength: 'concise',
            includeSources: false,
        }),
        user: { id: 'test-user' },
        headers: { get: () => 'test-header' }
    };

    const response = await capturedHandler(mockRequest, mockContext);
    assert.strictEqual(response.status, 200);

    assert.ok(capturedSystemContent.includes('<preferencias_asistente>'), 'Should include preferences block');
    assert.ok(capturedSystemContent.includes('tono didáctico y cercano'), 'Should include didactic tone instruction');
    assert.ok(capturedSystemContent.includes('Respondé de forma concisa'), 'Should include concise length instruction');
    assert.ok(capturedSystemContent.includes('No enumeres ni listes las fuentes'), 'Should include no-sources instruction');
    assert.strictEqual(capturedOptions?.max_tokens, 400, 'Should cap max_tokens at 400 for concise');
});

test('rag-query should omit preferences block when no bot prefs are sent', async () => {
    openaiMocks.generateEmbedding.mock.resetCalls();
    openaiMocks.chatCompletion.mock.resetCalls();

    let capturedSystemContent = '';
    let capturedOptions = null;
    openaiMocks.chatCompletion.mock.mockImplementation(async (messages, stream, options) => {
        const systemContent = messages?.[0]?.content || '';
        if (!stream && systemContent.includes('Reescribe la ultima pregunta del estudiante')) {
            return { content: 'plain test?', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
        }
        if (!stream) {
            capturedSystemContent = systemContent;
            capturedOptions = options;
            return { content: 'sync', usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } };
        }
        return (async function* () {
            yield { choices: [{ delta: { content: 'Ok' } }] };
            yield { usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 } };
        })();
    });

    const mockContext = { log: mock.fn(), error: mock.fn() };

    const mockRequest = {
        json: async () => ({
            question: 'Plain test?',
            subjectId: 'materia1',
            classIds: ['class1'],
            stream: false,
        }),
        user: { id: 'test-user' },
        headers: { get: () => 'test-header' }
    };

    const response = await capturedHandler(mockRequest, mockContext);
    assert.strictEqual(response.status, 200);

    assert.ok(!capturedSystemContent.includes('<preferencias_asistente>'), 'Should NOT include preferences block when absent');
    assert.ok(capturedOptions?.max_tokens > 400, 'Should keep default max_tokens when not concise');
});

test('#479/UJ-02: «más detalle» aplica al turno que lo pide y no a la preferencia guardada', async () => {
    openaiMocks.generateEmbedding.mock.resetCalls();
    openaiMocks.chatCompletion.mock.resetCalls();

    const capturado = [];
    openaiMocks.chatCompletion.mock.mockImplementation(async (messages, stream, options) => {
        const systemContent = messages?.[0]?.content || '';
        if (!stream && systemContent.includes('Reescribe la ultima pregunta del estudiante')) {
            return { content: 'mas detalle?', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
        }
        if (!stream) {
            capturado.push({ systemContent, options });
            return { content: 'sync', usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } };
        }
        return (async function* () {
            yield { choices: [{ delta: { content: 'Ok' } }] };
            yield { usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 } };
        })();
    });

    const pedir = (extra) => capturedHandler({
        json: async () => ({
            question: '¿Qué es el acoplamiento entre módulos?',
            subjectId: 'materia1',
            classIds: ['class1'],
            stream: false,
            // La preferencia guardada de la persona es «Concisa».
            botTone: 'formal',
            botLength: 'concise',
            ...extra,
        }),
        user: { id: 'test-user' },
        headers: { get: () => 'test-header' },
    }, { log: mock.fn(), error: mock.fn() });

    // 1. Consulta normal: rige la preferencia guardada.
    const normal = await pedir({});
    assert.strictEqual(normal.status, 200);
    // 2. La misma consulta con el pedido puntual de más detalle.
    const ampliada = await pedir({ lengthOverride: 'detailed' });
    assert.strictEqual(ampliada.status, 200);
    // 3. Otra consulta después del pedido puntual: la preferencia sigue mandando.
    const despues = await pedir({});
    assert.strictEqual(despues.status, 200);

    const [turnoNormal, turnoAmpliado, turnoDespues] = capturado;

    // Antes del arreglo el pedido no tenía efecto: el techo de 400 tokens y la
    // instrucción de brevedad seguían aplicándose (rag-query.js:708 / :147-161).
    assert.ok(turnoNormal.systemContent.includes('Respondé de forma concisa'), 'la consulta normal mantiene la instrucción concisa');
    assert.strictEqual(turnoNormal.options?.max_tokens, 400, 'la consulta normal mantiene el techo de 400 tokens');

    assert.ok(turnoAmpliado.systemContent.includes('Respondé de forma detallada'), 'el pedido puntual pide desarrollo');
    assert.ok(!turnoAmpliado.systemContent.includes('Respondé de forma concisa'), 'el pedido puntual no arrastra la instrucción opuesta');
    assert.ok(turnoAmpliado.systemContent.includes('<pedido_puntual>'), 'el pedido puntual se declara como pedido de un turno');
    assert.ok(turnoAmpliado.options?.max_tokens > 400, 'el pedido puntual no queda recortado por el techo de «Concisa»');

    // La preferencia guardada no cambió: el turno siguiente vuelve a ser conciso.
    assert.ok(turnoDespues.systemContent.includes('Respondé de forma concisa'), 'la consulta posterior vuelve a la preferencia guardada');
    assert.strictEqual(turnoDespues.options?.max_tokens, 400, 'la consulta posterior vuelve al techo de «Concisa»');
    assert.ok(!turnoDespues.systemContent.includes('<pedido_puntual>'), 'el pedido puntual no sobrevive al turno que lo pidió');
});

test('#479/UJ-02: el pedido puntual de longitud no se persiste en ninguna capa', async () => {
    storageMocks.saveJson.mock.resetCalls();
    storageMocks.getTableClient.mock.resetCalls();
    openaiMocks.chatCompletion.mock.mockImplementation(async (messages, stream) => {
        const systemContent = messages?.[0]?.content || '';
        if (!stream && systemContent.includes('Reescribe la ultima pregunta del estudiante')) {
            return { content: 'persistencia?', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
        }
        if (!stream) return { content: 'sync', usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } };
        return (async function* () {
            yield { choices: [{ delta: { content: 'Ok' } }] };
            yield { usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 } };
        })();
    });

    const response = await capturedHandler({
        json: async () => ({
            question: '¿Qué es el acoplamiento entre módulos?',
            subjectId: 'materia1',
            classIds: ['class1'],
            stream: false,
            botLength: 'concise',
            lengthOverride: 'detailed',
        }),
        user: { id: 'test-user' },
        headers: { get: () => 'test-header' },
    }, { log: mock.fn(), error: mock.fn() });
    assert.strictEqual(response.status, 200);

    // Ninguna escritura de este turno lleva la preferencia ni el pedido: el
    // override viaja por consulta, no por identidad (no hay endpoint de perfil
    // en el camino de rag-query, y ningún guardado lo incluye).
    const escrituras = storageMocks.saveJson.mock.calls.map(c => JSON.stringify(c.arguments)).join('\n');
    assert.ok(!/lengthOverride/.test(escrituras), 'el pedido puntual no se escribe en almacenamiento');
    assert.ok(!/botLength/.test(escrituras), 'la preferencia no se reescribe desde rag-query');
});

test('#479/UJ-02: un lengthOverride desconocido se ignora y no relaja el techo', async () => {
    let capturedOptions = null;
    let capturedSystemContent = '';
    openaiMocks.chatCompletion.mock.mockImplementation(async (messages, stream, options) => {
        const systemContent = messages?.[0]?.content || '';
        if (!stream && systemContent.includes('Reescribe la ultima pregunta del estudiante')) {
            return { content: 'invalido?', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
        }
        if (!stream) {
            capturedSystemContent = systemContent;
            capturedOptions = options;
            return { content: 'sync', usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } };
        }
        return (async function* () { yield { choices: [{ delta: { content: 'Ok' } }] }; })();
    });

    const response = await capturedHandler({
        json: async () => ({
            question: '¿Qué es el acoplamiento entre módulos?',
            subjectId: 'materia1',
            classIds: ['class1'],
            stream: false,
            botLength: 'concise',
            lengthOverride: 'extenso',
        }),
        user: { id: 'test-user' },
        headers: { get: () => 'test-header' },
    }, { log: mock.fn(), error: mock.fn() });

    assert.strictEqual(response.status, 200);
    assert.ok(capturedSystemContent.includes('Respondé de forma concisa'), 'rige la preferencia guardada');
    assert.strictEqual(capturedOptions?.max_tokens, 400, 'no se relaja el techo con un valor inválido');
    assert.ok(!capturedSystemContent.includes('<pedido_puntual>'), 'no se declara un pedido que no se entendió');
});

test('#358/UJ-22: isAbstentionAnswer detecta el rechazo canónico, los rechazos del modelo y la respuesta vacía', () => {
    assert.strictEqual(isAbstentionAnswer('No encontre informacion sobre eso en los materiales seleccionados.'), true, 'rechazo canónico sin tildes');
    assert.strictEqual(isAbstentionAnswer('No encontré información sobre eso en el material.'), true, 'rechazo del modelo con tildes');
    assert.strictEqual(isAbstentionAnswer('No tengo información al respecto.'), true);
    assert.strictEqual(isAbstentionAnswer(''), true, 'respuesta vacía');
    assert.strictEqual(isAbstentionAnswer('   '), true, 'respuesta en blanco');
    assert.strictEqual(isAbstentionAnswer('La arquitectura hexagonal usa puertos y adaptadores.'), false, 'respuesta con contenido no es abstención');
});

test('#358/UJ-22: la abstención sin contexto expone abstained=true en la metadata y el done del SSE', async () => {
    // Sin contexto: querySimilar no devuelve ningún match.
    vectorStoreMocks.querySimilar.mock.mockImplementation(async (embedding, filter) => {
        if (filter?.materialType?.$eq === 'verified-answer') return [];
        return [];
    });

    const mockContext = { log: mock.fn(), error: mock.fn() };
    const mockRequest = {
        json: async () => ({
            question: 'que dice el material sobre la preparacion de milanesas a caballo?',
            subjectId: 'materia1',
            classIds: ['class1'],
            stream: true,
        }),
        user: { id: 'test-user' },
        headers: { get: () => 'test-header' },
    };

    const response = await capturedHandler(mockRequest, mockContext);
    assert.strictEqual(response.status, 200);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let allText = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        allText += decoder.decode(value);
    }

    assert.ok(allText.includes('"abstained":true'), 'el SSE debe exponer abstained=true');
    assert.ok(allText.includes('No encontre informacion sobre eso en los materiales seleccionados.'), 'debe enviar el rechazo canónico');

    // Restaurar el mock por defecto para los tests que sigan.
    vectorStoreMocks.querySimilar.mock.mockImplementation(async (embedding, filter) => {
        if (filter?.materialType?.$eq === 'verified-answer') return [];
        return [
            {
                score: 0.9,
                metadata: {
                    sourceFilename: 'clase1.pdf',
                    text: 'Context text',
                    materialType: 'pdf',
                    classIds: ['class1'],
                    chunkIndex: 0,
                },
            },
        ];
    });
});

test('#358/UJ-22: el rechazo redactado por el modelo expone abstained=true en el done del SSE', async () => {
    openaiMocks.generateEmbedding.mock.resetCalls();
    openaiMocks.chatCompletion.mock.resetCalls();
    openaiMocks.chatCompletion.mock.mockImplementation(async (messages, stream) => {
        if (!stream) return { content: 'sync', usage: { total_tokens: 10 } };
        return (async function* () {
            yield { choices: [{ delta: { content: 'No encontré información ' } }] };
            yield { choices: [{ delta: { content: 'sobre eso en los materiales seleccionados.' } }] };
            yield { usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } };
        })();
    });

    const mockContext = { log: mock.fn(), error: mock.fn() };
    const mockRequest = {
        json: async () => ({
            question: 'que es el patron SAGA en detalle?',
            subjectId: 'materia1',
            classIds: ['class1'],
            stream: true,
        }),
        user: { id: 'test-user' },
        headers: { get: () => 'test-header' },
    };

    const response = await capturedHandler(mockRequest, mockContext);
    assert.strictEqual(response.status, 200);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let allText = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        allText += decoder.decode(value);
    }

    assert.ok(allText.includes('"abstained":true'), 'el done debe exponer abstained=true para un rechazo del modelo');
});


// ── #408 / UJ-27: determinismo declarado ────────────────────────────────
// El desacuerdo entre dos personas con la misma evidencia estaba en el muestreo
// del modelo y no se veía desde el producto. El arreglo baja la temperatura a 0
// y declara modelo + parámetros en cada respuesta; estos tests fijan las dos
// cosas para que no se pierdan en un refactor.

function parsearSse(texto) {
    const eventos = [];
    for (const bloque of String(texto).split('\n\n')) {
        const tipo = (bloque.match(/^event: (.*)$/m) || [])[1];
        const dato = (bloque.match(/^data: (.*)$/m) || [])[1];
        if (!tipo || !dato) continue;
        try { eventos.push({ tipo, dato: JSON.parse(dato) }); } catch { /* bloque parcial */ }
    }
    return eventos;
}

async function leerSse(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let texto = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        texto += decoder.decode(value);
    }
    return { texto, eventos: parsearSse(texto) };
}

test('#408: la respuesta se genera con temperature 0 y la declaración viaja en la metadata y el done', async () => {
    openaiMocks.generateEmbedding.mock.resetCalls();
    openaiMocks.chatCompletion.mock.resetCalls();
    openaiMocks.chatCompletion.mock.mockImplementation(async (messages, stream) => {
        if (!stream) return { content: 'sync', usage: { total_tokens: 10 } };
        return (async function* () {
            yield { choices: [{ delta: { content: 'La capa de aplicación ' } }] };
            yield { choices: [{ delta: { content: 'coordina casos de uso.' } }] };
            yield { usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } };
        })();
    });

    const mockContext = { log: mock.fn(), error: mock.fn() };
    const mockRequest = {
        json: async () => ({
            question: 'según el material, ¿qué responsabilidades tiene la capa de aplicación en una arquitectura por capas?',
            subjectId: 'materia1',
            classIds: ['class1'],
            stream: true,
        }),
        user: { id: 'test-user' },
        headers: { get: () => 'test-header' },
    };

    const response = await capturedHandler(mockRequest, mockContext);
    assert.strictEqual(response.status, 200);
    const { eventos } = await leerSse(response);

    // 1) Lo que se le pidió al modelo.
    const opcionesModelo = openaiMocks.chatCompletion.mock.calls.at(-1).arguments[2];
    assert.strictEqual(opcionesModelo.temperature, 0, 'la respuesta del asistente debe pedirse con temperature 0');
    assert.strictEqual(opcionesModelo.max_tokens, 1500, 'el tope de tokens sigue siendo el declarado');

    // 2) Lo que se declara en la respuesta.
    const metadata = eventos.find((e) => e.tipo === 'metadata')?.dato;
    assert.ok(metadata?.generation, 'la metadata debe declarar la configuración de generación');
    assert.strictEqual(metadata.generation.temperature, 0);
    assert.strictEqual(metadata.generation.model, 'deepseek-v4-flash');
    assert.strictEqual(metadata.generation.maxTokens, 1500);
    assert.strictEqual(metadata.generation.promptVersion, 'v1');
    assert.strictEqual(metadata.generation.determinism, 'temperature-0');
    assert.strictEqual(metadata.generation.topP, null, 'top_p no se envía: no se puede declarar como propio');
    assert.strictEqual(metadata.generation.topPSource, 'proveedor');
    assert.match(metadata.generation.label, /temperatura 0/, 'la etiqueta legible incluye la temperatura');
    assert.match(metadata.generation.label, /máx\. 1500 tokens/);
    assert.strictEqual(metadata.evidenceCount, 1, 'la cantidad de evidencia adjunta es parte de la declaración');
    assert.strictEqual(metadata.abstained, undefined, 'la abstención no se puede anunciar antes de generar');

    const done = eventos.find((e) => e.tipo === 'done')?.dato;
    assert.strictEqual(done?.abstained, false);
    assert.deepStrictEqual(done?.generation, metadata.generation, 'el done repite la misma declaración que la metadata');
});

test('#408: el camino sin stream también genera con temperature 0 y declara la configuración', async () => {
    openaiMocks.chatCompletion.mock.resetCalls();
    openaiMocks.chatCompletion.mock.mockImplementation(async () => ({
        content: 'La capa de aplicación coordina casos de uso.',
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    }));

    const mockContext = { log: mock.fn(), error: mock.fn() };
    const mockRequest = {
        json: async () => ({
            question: '¿qué responsabilidades tiene la capa de aplicación?',
            subjectId: 'materia1',
            classIds: ['class1'],
            stream: false,
            botLength: 'concise',
        }),
        user: { id: 'test-user' },
        headers: { get: () => 'test-header' },
    };

    const response = await capturedHandler(mockRequest, mockContext);
    assert.strictEqual(response.status, 200);

    const opcionesModelo = openaiMocks.chatCompletion.mock.calls.at(-1).arguments[2];
    assert.strictEqual(opcionesModelo.temperature, 0);
    assert.strictEqual(opcionesModelo.max_tokens, 400, 'concise mantiene su tope de 400');

    const body = JSON.parse(response.body);
    assert.ok(body.generation, 'el payload sin stream declara la configuración');
    assert.strictEqual(body.generation.temperature, 0);
    assert.strictEqual(body.generation.maxTokens, 400);
    assert.strictEqual(body.model, 'deepseek-v4-flash');
    assert.strictEqual(body.evidenceCount, 1);
    assert.strictEqual(body.abstained, false);
});

test('#408: una abstención CON evidencia disponible se declara distinto de una sin evidencia', async () => {
    openaiMocks.chatCompletion.mock.resetCalls();
    openaiMocks.chatCompletion.mock.mockImplementation(async (messages, stream) => {
        if (!stream) return { content: 'sync', usage: { total_tokens: 10 } };
        return (async function* () {
            yield { choices: [{ delta: { content: 'No encontré información sobre eso ' } }] };
            yield { choices: [{ delta: { content: 'en los materiales seleccionados.' } }] };
            yield { usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } };
        })();
    });

    const mockContext = { log: mock.fn(), error: mock.fn() };
    const mockRequest = {
        json: async () => ({
            question: 'que es el acoplamiento entre modulos?',
            subjectId: 'materia1',
            classIds: ['class1'],
            stream: true,
        }),
        user: { id: 'test-user' },
        headers: { get: () => 'test-header' },
    };

    const response = await capturedHandler(mockRequest, mockContext);
    const { eventos } = await leerSse(response);

    const metadata = eventos.find((e) => e.tipo === 'metadata')?.dato;
    const done = eventos.find((e) => e.tipo === 'done')?.dato;

    assert.strictEqual(metadata.evidenceCount, 1, 'la evidencia recuperada existe y se adjunta');
    assert.strictEqual(done.abstained, true, 'el modelo se abstuvo');
    assert.strictEqual(done.evidenceCount, 1);
    assert.strictEqual(done.abstainedWithEvidence, true, 'abstención del modelo pese a tener evidencia: es lo que hay que poder distinguir');
});

test('#408: una abstención SIN evidencia no se declara como abstención con evidencia', async () => {
    openaiMocks.chatCompletion.mock.resetCalls();
    vectorStoreMocks.querySimilar.mock.mockImplementation(async (embedding, filter) => {
        if (filter?.materialType?.$eq === 'verified-answer') return [];
        return [];
    });
    const mockContext = { log: mock.fn(), error: mock.fn() };
    const mockRequest = {
        json: async () => ({
            question: 'tema que no esta en la materia',
            subjectId: 'materia1',
            classIds: ['class1'],
            stream: true,
            conversationHistory: [{ role: 'user', content: 'pregunta previa' }, { role: 'assistant', content: 'respuesta previa' }],
        }),
        user: { id: 'test-user' },
        headers: { get: () => 'test-header' },
    };

    const response = await capturedHandler(mockRequest, mockContext);
    assert.strictEqual(response.status, 200);

    // Sin material el rechazo es canónico y no se gasta modelo (UJ-22/#410).
    let body = response.body;
    if (body instanceof ReadableStream) {
        const { eventos } = await leerSse(response);
        const done = eventos.find((e) => e.tipo === 'done')?.dato;
        assert.strictEqual(done.abstained, true);
        assert.strictEqual(done.evidenceCount, 0);
        assert.strictEqual(done.abstainedWithEvidence, false);
    } else {
        body = JSON.parse(response.body);
        assert.strictEqual(body.evidenceCount, 0);
        assert.strictEqual(body.abstainedWithEvidence, false);
    }

    // Restaurar el mock por defecto para los tests que siguen.
    vectorStoreMocks.querySimilar.mock.mockImplementation(async (embedding, filter) => {
        if (filter?.materialType?.$eq === 'verified-answer') return [];
        return [{
            score: 0.9,
            metadata: { sourceFilename: 'clase1.pdf', text: 'Context text', materialType: 'pdf', classIds: ['class1'], chunkIndex: 0 },
        }];
    });
});
