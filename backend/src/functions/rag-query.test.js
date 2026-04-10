import { test, mock } from 'node:test';
import assert from 'node:assert';

// Define mocks before importing the function under test
const openaiMocks = {
    generateEmbedding: mock.fn(async () => ({
        embedding: [0.1, 0.2, 0.3],
        usage: { total_tokens: 5 }
    })),
    chatCompletion: mock.fn(async () => ({ 
        content: 'Respuesta simulada (Fuente 1).',
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
    }))
};

const vectorStoreMocks = {
    querySimilar: mock.fn(async () => [
        {
            score: 0.9,
            metadata: {
                sourceFilename: 'clase1.pdf',
                text: 'Contenido de la clase 1',
                materialType: 'pdf',
                classIds: ['class1'],
                chunkIndex: 0
            }
        }
    ]),
    getIndexStats: mock.fn(async () => ({ totalVectorCount: 0, indexFullness: 0, namespaces: {} }))
};

const storageMocks = {
    saveJson: mock.fn(async () => true),
    saveMetricsToTable: mock.fn(async () => true)
};

const promptsMocks = {
    getShadowPrompt: mock.fn(() => ({
        id: 'v1-baseline',
        content: `Eres el Asistente Académico Experto del Dashboard UADE Innova.
Tu objetivo es asistir a los estudiantes manteniendo un tono académico formal, preciso y profesional, siguiendo el estilo institucional de la UADE.

REGLAS DE COMPORTAMIENTO:
1. Responde ÚNICAMENTE basándote en el "CONTEXTO DE LOS MATERIALES" proporcionado abajo. No utilices conocimiento externo, previo o general.
2. Si la información necesaria para responder no se encuentra en el contexto, debes responder exactamente: "No encontré información sobre eso en los materiales seleccionados."
3. Si el usuario realiza preguntas fuera de los temas académicos o de los materiales proporcionados, declina la respuesta de manera formal y profesional.
4. Cita siempre tus fuentes utilizando el formato (Fuente 1), (Fuente 2), etc., para respaldar cada afirmación.
5. Mantén estrictamente un lenguaje formal y académico en español.`
    }))
};

const authUtilsMocks = {
    validateFrontDoorId: mock.fn(() => true),
    parseClientPrincipal: mock.fn(() => ({ oid: 'test-user-oid', userRoles: ['Alumno'] })),
};

const telemetryMocks = {
    trackRAGInteraction: mock.fn(async () => {}),
};

// Mock dependencies
mock.module('../services/openai.js', { namedExports: openaiMocks });
mock.module('../services/vector-store.js', { namedExports: vectorStoreMocks });
mock.module('../services/storage.js', { namedExports: storageMocks });
mock.module('../services/prompts.js', { namedExports: promptsMocks });
mock.module('../services/auth-utils.js', { namedExports: authUtilsMocks });
mock.module('../services/telemetry.js', { namedExports: telemetryMocks });

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
await import('./rag-query.js');

test('rag-query handler should be registered', () => {
    assert.strictEqual(typeof capturedHandler, 'function');
});

test('rag-query should include correct system prompt and rules', async (t) => {
    openaiMocks.chatCompletion.mock.resetCalls();
    
    const mockContext = {
        log: mock.fn(),
        error: mock.fn()
    };

    const mockRequest = {
        json: async () => ({
            question: '¿Qué es la UADE?',
            subjectId: 'materia1',
            classIds: ['class1']
        }),
        user: { id: 'test-user' }
    };

    await capturedHandler(mockRequest, mockContext);

    // Verify chatCompletion was called
    assert.strictEqual(openaiMocks.chatCompletion.mock.callCount(), 1);
    
    const messages = openaiMocks.chatCompletion.mock.calls[0].arguments[0];
    const systemPrompt = messages.find(m => m.role === 'system').content;

    // 1. Verify system prompt includes "Asistente Académico Experto del Dashboard UADE Innova"
    assert.ok(systemPrompt.includes('Asistente Académico Experto del Dashboard UADE Innova'), 'System prompt should include the correct role');

    // 2. Verify Rule 1 (Tono Formal), Rule 2 (No adivines), and Rule 3 (Specific refusal message)
    assert.ok(systemPrompt.includes('tono académico formal'), 'Rule 1 (Formal tone) should be present');
    assert.ok(systemPrompt.includes('No utilices conocimiento externo'), 'Rule 2 (No guessing) should be present');
    assert.ok(systemPrompt.includes('No encontré información sobre eso en los materiales seleccionados.'), 'Rule 3 (Refusal message) should be present in system prompt');
    
    // Additional check for Rule 4 (Citations) and Rule 5 (Spanish)
    assert.ok(systemPrompt.includes('Cita siempre tus fuentes'), 'Rule 4 (Citations) should be present');
    assert.ok(systemPrompt.includes('lenguaje formal y académico en español'), 'Rule 5 (Spanish) should be present');
});

test('rag-query should return the refusal message if OpenAI returns it', async (t) => {
    const refusalMessage = 'No encontré información sobre eso en los materiales seleccionados.';
    openaiMocks.chatCompletion.mock.resetCalls();
    openaiMocks.chatCompletion.mock.mockImplementationOnce(async () => ({ 
        content: refusalMessage,
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    }));

    const mockContext = {
        log: mock.fn(),
        error: mock.fn()
    };

    const mockRequest = {
        json: async () => ({
            question: 'Pregunta sin respuesta',
            subjectId: 'materia1'
        })
    };

    const response = await capturedHandler(mockRequest, mockContext);
    const body = JSON.parse(response.body);

    assert.strictEqual(body.answer, refusalMessage);
});

test('rag-query should use correct refusal string when vector search returns empty', async (t) => {
    vectorStoreMocks.querySimilar.mock.mockImplementationOnce(async () => []);
    openaiMocks.chatCompletion.mock.resetCalls();

    const mockContext = {
        log: mock.fn(),
        error: mock.fn()
    };

    const mockRequest = {
        json: async () => ({
            question: 'Pregunta que no existe',
            subjectId: 'materia1'
        })
    };

    const response = await capturedHandler(mockRequest, mockContext);
    const body = JSON.parse(response.body);

    assert.strictEqual(body.answer, 'No encontré información sobre eso en los materiales seleccionados.');
    assert.strictEqual(openaiMocks.chatCompletion.mock.callCount(), 0, 'Should not call OpenAI if no matches found');
});

test('rag-query should rewrite follow-up questions using recent history', async () => {
    openaiMocks.generateEmbedding.mock.resetCalls();
    openaiMocks.chatCompletion.mock.resetCalls();

    openaiMocks.chatCompletion.mock.mockImplementation(async (messages) => {
        const systemContent = messages?.[0]?.content || '';
        if (systemContent.includes('Reescribe la ultima pregunta del estudiante')) {
            return {
                content: '¿Por que es importante la arquitectura hexagonal?',
                usage: { prompt_tokens: 8, completion_tokens: 6, total_tokens: 14 }
            };
        }

        return {
            content: 'Es importante porque separa la logica de negocio de la infraestructura.',
            usage: { prompt_tokens: 20, completion_tokens: 12, total_tokens: 32 }
        };
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
            historyWindowSize: 4,
            conversationHistory: [
                { role: 'user', content: '¿Que es la arquitectura hexagonal?' },
                { role: 'assistant', content: 'Es un enfoque basado en puertos y adaptadores.' },
                { role: 'user', content: '¿Para que sirve?' },
                { role: 'assistant', content: 'Sirve para desacoplar el dominio de detalles tecnicos.' }
            ]
        }),
        user: { id: 'test-user' }
    };

    await capturedHandler(mockRequest, mockContext);

    assert.strictEqual(openaiMocks.generateEmbedding.mock.calls.at(-1).arguments[0], '¿Por que es importante la arquitectura hexagonal?');

    const ragMessages = openaiMocks.chatCompletion.mock.calls.at(-1).arguments[0];
    const ragUserMessage = ragMessages.find(m => m.role === 'user');
    assert.strictEqual(ragUserMessage.content, '¿Por que es importante la arquitectura hexagonal?');
});

test('rag-query should keep original question when history is not provided', async () => {
    openaiMocks.generateEmbedding.mock.resetCalls();
    openaiMocks.chatCompletion.mock.resetCalls();

    const mockContext = {
        log: mock.fn(),
        error: mock.fn()
    };

    const mockRequest = {
        json: async () => ({
            question: '¿Que es DDD?',
            subjectId: 'materia1',
            classIds: ['class1']
        }),
        user: { id: 'test-user' }
    };

    await capturedHandler(mockRequest, mockContext);

    assert.strictEqual(openaiMocks.chatCompletion.mock.callCount(), 1, 'Only the final RAG completion should run');
    assert.strictEqual(openaiMocks.generateEmbedding.mock.calls[0].arguments[0], '¿Que es DDD?');
});

test('rag-query should include transcript focus in system prompt when provided', async () => {
    openaiMocks.chatCompletion.mock.resetCalls();

    const mockContext = {
        log: mock.fn(),
        error: mock.fn(),
    };

    const mockRequest = {
        json: async () => ({
            question: 'Explicame este tramo',
            subjectId: 'materia1',
            classIds: ['class1'],
            transcriptFocus: {
                sectionId: 'sec-002',
                label: 'pregunta sobre atributos de calidad',
            },
        }),
        user: { id: 'test-user' },
    };

    await capturedHandler(mockRequest, mockContext);

    const messages = openaiMocks.chatCompletion.mock.calls.at(-1).arguments[0];
    const systemPrompt = messages.find(m => m.role === 'system').content;
    assert.ok(systemPrompt.includes('FOCO DE TRANSCRIPCION'), 'Should include transcript focus block');
    assert.ok(systemPrompt.includes('atributos de calidad'), 'Should include selected focus label');
});

test('rag-query should return SAFETY category when model blocks the prompt', async () => {
    openaiMocks.chatCompletion.mock.resetCalls();
    openaiMocks.chatCompletion.mock.mockImplementationOnce(async () => {
        const err = new Error('Blocked by safety policy');
        err.code = 'content_filter';
        err.status = 400;
        throw err;
    });

    const mockContext = {
        log: mock.fn(),
        error: mock.fn(),
    };

    const mockRequest = {
        json: async () => ({
            question: 'Explica como hackear un sistema',
            subjectId: 'materia1',
            classIds: ['class1'],
        }),
    };

    const response = await capturedHandler(mockRequest, mockContext);
    const body = JSON.parse(response.body);

    assert.strictEqual(response.status, 400);
    assert.strictEqual(body.errorCategory, 'SAFETY');
    assert.ok(String(body.error || '').includes('Error generando respuesta (chat)'), 'Should preserve chat error context');
});
