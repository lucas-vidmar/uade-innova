/**
 * services/ai.js — Servicio Unificado de IA (Azure OpenAI + DeepSeek)
 * Maneja embeddings vía Azure OpenAI y generación de texto vía DeepSeek V4 Flash.
 */
import { AzureOpenAI, OpenAI } from 'openai';
import { CategorizedError, ErrorCategory } from './error-categories.js';

let _embeddingClient = null;
let _chatClient = null;

/**
 * Cliente para Embeddings (Azure OpenAI)
 * Mantenemos text-embedding-3-small por consistencia en Pinecone.
 */
function getEmbeddingClient() {
    if (!_embeddingClient) {
        const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
        const apiKey = process.env.AZURE_OPENAI_KEY || process.env.AZURE_OPENAI_API_KEY;

        if (!endpoint || !apiKey) {
            throw new Error('Azure OpenAI configuration (endpoint/key) is missing for embeddings.');
        }

        _embeddingClient = new AzureOpenAI({
            endpoint,
            apiKey,
            apiVersion: '2024-08-01-preview',
        });
        console.log('[AI] Embedding Client (Azure OpenAI) initialized');
    }
    return _embeddingClient;
}

/**
 * Cliente para Generación (Azure AI Foundry - DeepSeek)
 * DeepSeek V4 Flash es compatible con la API de OpenAI.
 */
function getChatClient() {
    if (!_chatClient) {
        // Preferimos DeepSeek si está configurado
        const dsEndpoint = process.env.AI_FOUNDRY_DEEPSEEK_ENDPOINT;
        const dsKey = process.env.AI_FOUNDRY_DEEPSEEK_KEY;

        if (dsEndpoint && dsKey) {
            _chatClient = new OpenAI({
                baseURL: dsEndpoint.endsWith('/v1') ? dsEndpoint : `${dsEndpoint.replace(/\/$/, '')}/v1`,
                apiKey: dsKey,
            });
            console.log('[AI] Chat Client (DeepSeek V4 Flash via Foundry) initialized');
        } else {
            // Fallback a Azure OpenAI si no hay DeepSeek (para retrocompatibilidad)
            const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
            const apiKey = process.env.AZURE_OPENAI_KEY || process.env.AZURE_OPENAI_API_KEY;
            
            if (!endpoint || !apiKey) {
                throw new Error('No valid AI Chat configuration found (DeepSeek or Azure OpenAI).');
            }

            _chatClient = new AzureOpenAI({
                endpoint,
                apiKey,
                apiVersion: '2024-08-01-preview',
            });
            console.log('[AI] Chat Client (Azure OpenAI Fallback) initialized');
        }
    }
    return _chatClient;
}

/**
 * Genera embeddings vectoriales para un array de textos.
 */
export async function generateEmbeddingsBatch(texts, options = {}) {
    const client = getEmbeddingClient();

    const executeWithRetry = async (fn, retries = 3, delay = 1000) => {
        try {
            return await fn();
        } catch (err) {
            const isRateLimit = err.status === 429 || err.message?.includes('Too Many Requests');
            if (retries > 0 && isRateLimit) {
                const nextDelay = delay * 2;
                console.warn(`[AI] Rate limit (embeddings). Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return executeWithRetry(fn, retries - 1, nextDelay);
            }
            throw err;
        }
    };

    const model = process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || 'text-embedding-3-small';

    const response = await executeWithRetry(() =>
        client.embeddings.create(
            {
                model,
                input: texts.map(t => t.trim()),
            },
            { headers: options.headers }
        )
    );

    return {
        embeddings: response.data.map(d => d.embedding),
        usage: response.usage
    };
}

export async function generateEmbedding(text, options = {}) {
    const { embeddings, usage } = await generateEmbeddingsBatch([text], options);
    return { embedding: embeddings[0], usage };
}

/**
 * Chat Completion (Generación de respuestas)
 * Usa DeepSeek V4 Flash por defecto si está configurado.
 */
export async function chatCompletion(messages, stream = false, overrides = {}) {
    const client = getChatClient();
    const isDeepSeek = !(client instanceof AzureOpenAI);
    
    const { headers, ...modelOverrides } = overrides || {};
    
    // Si es DeepSeek, usamos el nombre del modelo de Foundry. Si es Azure OpenAI, el deployment.
    const model = isDeepSeek 
        ? (process.env.AI_FOUNDRY_DEEPSEEK_MODEL || 'deepseek-v4-flash')
        : process.env.AZURE_OPENAI_CHAT_DEPLOYMENT;

    const options = {
        model,
        messages,
        temperature: 0.3,
        max_tokens: 1500,
        stream,
        ...modelOverrides,
    };

    try {
        if (stream) {
            return await client.chat.completions.create(options, { headers });
        }

        const response = await client.chat.completions.create(options, { headers });
        return {
            content: response.choices[0].message.content,
            usage: response.usage
        };
    } catch (err) {
        const text = `${err?.message || ''} ${err?.code || ''}`.toLowerCase();
        if (text.includes('content_filter') || text.includes('safety')) {
            throw new CategorizedError('La consulta fue bloqueada por politicas de seguridad del modelo.', {
                errorCategory: ErrorCategory.SAFETY,
                code: 'SAFETY_BLOCKED',
                status: err?.status || 400,
                details: err?.error || null,
                cause: err,
            });
        }
        throw err;
    }
}

/**
 * Resumen de clase estructurado.
 */
export async function generateClassSummary(text, subjectName = "", options = {}) {
    const prompt = `Eres un asistente academico experto en la UADE. Genera un resumen estructurado... [Materia: ${subjectName}]\n\nTEXTO:\n${text.substring(0, 15000)}`;

    const response = await chatCompletion([
        { role: "system", content: "Generas resumenes academicos profesionales." },
        { role: "user", content: prompt }
    ], false, { temperature: 0.5, max_tokens: 2000, headers: options.headers });

    return {
        content: response.content,
        usage: response.usage,
        generatedAt: new Date().toISOString(),
        model: process.env.AI_FOUNDRY_DEEPSEEK_MODEL || 'deepseek-v4-flash'
    };
}

/**
 * Mapa conceptual Mermaid.
 */
export async function generateClassMap(text, options = {}) {
    const prompt = `Genera un mapa conceptual Mermaid.js (graph TD) para:\n${text.substring(0, 10000)}`;

    const response = await chatCompletion([
        { role: "system", content: "Generas diagramas Mermaid.js precisos." },
        { role: "user", content: prompt }
    ], false, { temperature: 0.4, max_tokens: 1500, headers: options.headers });

    return {
        code: response.content.replace(/```mermaid\n?|```/g, '').trim(),
        usage: response.usage,
        generatedAt: new Date().toISOString(),
    };
}

/**
 * Genera audio (TTS)
 * DeepSeek no suele tener TTS, mantenemos Azure OpenAI.
 */
export async function generateClassAudio(text, voice = 'nova', options = {}) {
    // Para TTS siempre usamos Azure OpenAI (o el cliente que lo soporte)
    // Forzamos el uso de un cliente AzureOpenAI si es posible
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const apiKey = process.env.AZURE_OPENAI_KEY || process.env.AZURE_OPENAI_API_KEY;
    
    const ttsClient = new AzureOpenAI({ endpoint, apiKey, apiVersion: '2024-08-01-preview' });

    const response = await ttsClient.audio.speech.create(
        {
            model: process.env.AZURE_OPENAI_TTS_DEPLOYMENT || 'tts-1',
            voice,
            input: text.substring(0, 4000),
        },
        { headers: options.headers }
    );

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}
