import { test, mock } from 'node:test';
import assert from 'node:assert';

// Define mocks before importing the function under test
const openaiMocks = {
    generateEmbedding: mock.fn(async () => [0.1, 0.2, 0.3]),
    chatCompletion: mock.fn(async () => ({ 
        content: 'Respuesta simulada (Fuente 1).',
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
    }))
};

const pineconeMocks = {
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
    ])
};

const storageMocks = {
    saveJson: mock.fn(async () => true),
    saveMetricsToTable: mock.fn(async () => true)
};

// Mock dependencies
mock.module('../services/openai.js', { namedExports: openaiMocks });
mock.module('../services/pinecone.js', { namedExports: pineconeMocks });
mock.module('../services/storage.js', { namedExports: storageMocks });

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

test('rag-query should use correct refusal string when Pinecone returns empty', async (t) => {
    pineconeMocks.querySimilar.mock.mockImplementationOnce(async () => []);
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
