/**
 * services/ai.js — Servicio Unificado de IA (Azure OpenAI + DeepSeek)
 * Maneja embeddings vía Azure OpenAI y generación de texto vía DeepSeek V4 Flash.
 */
import { AzureOpenAI, OpenAI } from 'openai';
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import { CategorizedError, ErrorCategory } from './error-categories.js';
import { extractMermaidCode } from '../../shared/extract-mermaid.js';
import { getActivePrompt } from './prompts.js';

const AOAI_TOKEN_SCOPE = 'https://cognitiveservices.azure.com/.default';

let _embeddingClient = null;
let _chatClient = null;
let _tokenProvider = null;

function getTokenProvider() {
    if (!_tokenProvider) {
        const credential = new DefaultAzureCredential();
        _tokenProvider = getBearerTokenProvider(credential, AOAI_TOKEN_SCOPE);
    }
    return _tokenProvider;
}

function createAzureOpenAIClient(azureAdTokenProvider) {
    return new AzureOpenAI({
        endpoint: process.env.AZURE_OPENAI_ENDPOINT,
        apiKey: process.env.AZURE_OPENAI_KEY || process.env.AZURE_OPENAI_API_KEY || undefined,
        azureADTokenProvider: azureAdTokenProvider,
        apiVersion: '2024-08-01-preview',
    });
}

/**
 * Cliente para Embeddings (Azure OpenAI)
 * Uses Managed Identity (DefaultAzureCredential) when no API key is set.
 */
function getEmbeddingClient() {
    if (!_embeddingClient) {
        const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
        if (!endpoint) {
            throw new Error('AZURE_OPENAI_ENDPOINT is required for embeddings.');
        }

        const apiKey = process.env.AZURE_OPENAI_KEY || process.env.AZURE_OPENAI_API_KEY;
        if (apiKey) {
            _embeddingClient = new AzureOpenAI({ endpoint, apiKey, apiVersion: '2024-08-01-preview' });
            console.log('[AI] Embedding Client (Azure OpenAI + API Key) initialized');
        } else {
            _embeddingClient = createAzureOpenAIClient(getTokenProvider());
            console.log('[AI] Embedding Client (Azure OpenAI + Managed Identity) initialized');
        }
    }
    return _embeddingClient;
}

/**
 * Cliente para Generación (Azure AI Foundry - DeepSeek)
 * DeepSeek V4 Flash es compatible con la API de OpenAI.
 * Falls back to Azure OpenAI with Managed Identity if DeepSeek is not configured.
 */
function getChatClient() {
    if (!_chatClient) {
        const dsEndpoint = process.env.AI_FOUNDRY_DEEPSEEK_ENDPOINT;
        const dsKey = process.env.AI_FOUNDRY_DEEPSEEK_KEY;

        if (dsEndpoint && dsKey) {
            _chatClient = new OpenAI({
                baseURL: dsEndpoint.replace(/\/$/, ''),
                apiKey: dsKey,
                fetch: async (url, init) => {
                    const headers = new Headers(init.headers);
                    headers.set('api-key', dsKey);
                    headers.delete('authorization');
                    const parsedUrl = new URL(url);
                    parsedUrl.searchParams.set('api-version', '2024-08-01-preview');
                    return fetch(parsedUrl.toString(), { ...init, headers });
                },
            });
            console.log('[AI] Chat Client (DeepSeek V4 Flash via Azure AI Services) initialized');
        } else {
            const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
            if (!endpoint) {
                throw new Error('No valid AI Chat configuration found (DeepSeek or Azure OpenAI).');
            }

            const apiKey = process.env.AZURE_OPENAI_KEY || process.env.AZURE_OPENAI_API_KEY;
            if (apiKey) {
                _chatClient = new AzureOpenAI({ endpoint, apiKey, apiVersion: '2024-08-01-preview' });
                console.log('[AI] Chat Client (Azure OpenAI Fallback + API Key) initialized');
            } else {
                _chatClient = createAzureOpenAIClient(getTokenProvider());
                console.log('[AI] Chat Client (Azure OpenAI Fallback + Managed Identity) initialized');
            }
        }
    }
    return _chatClient;
}

/**
 * Genera embeddings vectoriales para un array de textos.
 */
export async function generateEmbeddingsBatch(texts, options = {}) {
    const client = getEmbeddingClient();

    const executeWithRetry = async (fn, retries = 8, delay = 5000) => {
        try {
            return await fn();
    } catch (err) {
        console.error('[AI] Chat completion error:', JSON.stringify({
            message: err?.message,
            code: err?.code,
            status: err?.status,
            type: err?.type,
            url: err?.url,
            stack: err?.stack?.split('\n').slice(0, 3).join('\n'),
        }));
            const isRateLimit = err.status === 429 || err.message?.includes('Too Many Requests');
            if (retries > 0 && isRateLimit) {
                const retryAfter = err.headers?.get?.('retry-after-ms') || err.headers?.get?.('Retry-After');
                const retryDelay = retryAfter ? Math.max(Number(retryAfter), delay) : delay;
                const jitter = Math.random() * 2000;
                const waitMs = Math.min(retryDelay + jitter, 60000);
                console.warn(`[AI] Rate limit (embeddings). Retrying in ${Math.round(waitMs)}ms... (${retries} retries left)`);
                await new Promise(resolve => setTimeout(resolve, waitMs));
                return executeWithRetry(fn, retries - 1, Math.min(delay * 1.5, 60000));
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

export function isChatUsingDeepSeek() {
    return !!(process.env.AI_FOUNDRY_DEEPSEEK_ENDPOINT && process.env.AI_FOUNDRY_DEEPSEEK_KEY);
}

export function getChatModelName() {
    if (isChatUsingDeepSeek()) {
        return process.env.AI_FOUNDRY_DEEPSEEK_MODEL || 'deepseek-v4-flash';
    }
    return process.env.AZURE_OPENAI_CHAT_DEPLOYMENT || 'gpt-4o-mini';
}

/**
 * Chat Completion (Generación de respuestas)
 * Usa DeepSeek V4 Flash por defecto si está configurado.
 */
export async function chatCompletion(messages, stream = false, overrides = {}) {
    const client = getChatClient();
    const isDeepSeek = isChatUsingDeepSeek();
    
    const { headers, signal, ...modelOverrides } = overrides || {};
    
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
            return await client.chat.completions.create(options, { headers, signal });
        }

        const response = await client.chat.completions.create(options, { headers, signal });
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
    const promptConfig = await getActivePrompt('class-summary').catch(() => null);
    const systemContent = promptConfig?.systemPrompt || 'Generas resúmenes académicos profesionales. Tu respuesta debe contener únicamente el texto del resumen, sin frases introductorias ("Claro, aquí tienes...", "Te presento...", etc.), sin despedidas, ni ningún otro texto adicional.';
    const userTemplate = promptConfig?.userPromptTemplate || 'Resumí el siguiente texto de clase de forma estructurada y profesional. Devolvé únicamente el contenido del resumen, sin introducciones, saludos, comentarios ni cierres.\n\nMateria: ${subjectName}\n\nTEXTO:\n${text}';
    const userContent = userTemplate
        .replace('${subjectName}', subjectName)
        .replace('${text}', text.substring(0, 15000));

    const response = await chatCompletion([
        { role: "system", content: systemContent },
        { role: "user", content: userContent }
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
    const promptConfig = await getActivePrompt('mermaid').catch(() => null);
    const systemContent = promptConfig?.systemPrompt || 'Generas diagramas Mermaid.js precisos. Usá comillas dobles en labels con paréntesis. Tu respuesta debe contener únicamente el código Mermaid.js puro, sin etiquetas de código (```mermaid), sin explicaciones previas ni comentarios posteriores.';
    const userTemplate = promptConfig?.userPromptTemplate || 'Generá un mapa conceptual Mermaid.js (graph TD) para el siguiente texto.\n\n${text}\n\nIMPORTANTE: Usá comillas dobles en los labels que contengan paréntesis, ej: A["texto (año)"] en lugar de A[texto (año)]. Devolvé únicamente el código Mermaid.js, sin ninguna explicación adicional.';
    const userContent = userTemplate.replace('${text}', text.substring(0, 10000));

    const response = await chatCompletion([
        { role: "system", content: systemContent },
        { role: "user", content: userContent }
    ], false, { temperature: 0.4, max_tokens: 1500, headers: options.headers });

    return {
        code: extractMermaidCode(response.content),
        usage: response.usage,
        generatedAt: new Date().toISOString(),
    };
}

/**
 * Guión de podcast a partir del resumen de clase
 */
export async function generatePodcastScript(summaryText, subjectName = '', className = '', options = {}) {
    const promptConfig = await getActivePrompt('class-podcast').catch(() => null);
    const systemContent = promptConfig?.systemPrompt || 'Sos un asistente experto en comunicación educativa. Generás guiones de audio listos para síntesis de voz (TTS). El guión debe ser texto plano narrativo continuo, sin metadatos, sin etiquetas de locutor, sin indicaciones de sonido ni música, sin títulos, sin duración estimada, y sin marcas de inicio o fin. Solo la voz del narrador en español argentino neutro.';
    const userTemplate = promptConfig?.userPromptTemplate || 'Generá un guión de audio narrativo en español argentino neutro a partir del siguiente resumen de clase. El guión será convertido a voz mediante TTS, por lo que debe cumplir estas reglas:\n\n1. Texto plano continuo — NO uses "Locutor:", "Narrador:" ni ningún prefijo de personaje\n2. NO incluyas indicaciones de música, efectos de sonido ni pausas (nada de "[Música]", "[pausa]", etc.)\n3. Sin título, sin duración estimada, sin metadatos\n4. Sin frases de apertura ("Aquí tienes el guión") ni cierre ("Fin del guión")\n5. Debe sonar natural al ser leído en voz alta, como un docente explicando conceptos\n6. Incluí introducción y cierre como parte del mismo texto narrativo fluido\n\nMateria: ${subjectName}\nClase: ${className}\n\nResumen:\n${summaryText}';
    const userContent = userTemplate
        .replace('${subjectName}', subjectName)
        .replace('${className}', className)
        .replace('${summaryText}', summaryText.substring(0, 12000));

    const response = await chatCompletion([
        { role: "system", content: systemContent },
        { role: "user", content: userContent }
    ], false, { temperature: 0.5, max_tokens: 2000, headers: options.headers });

    return {
        content: response.content,
        usage: response.usage,
        generatedAt: new Date().toISOString(),
        model: process.env.AI_FOUNDRY_DEEPSEEK_MODEL || 'deepseek-v4-flash'
    };
}

/**
 * Genera audio (TTS)
 * DeepSeek no suele tener TTS, mantenemos Azure OpenAI.
 */
export async function generateClassAudio(text, voice = 'nova', options = {}) {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    if (!endpoint) throw new Error('AZURE_OPENAI_ENDPOINT is required for TTS.');

    const apiKey = process.env.AZURE_OPENAI_KEY || process.env.AZURE_OPENAI_API_KEY;
    let ttsClient;
    if (apiKey) {
        ttsClient = new AzureOpenAI({ endpoint, apiKey, apiVersion: '2024-08-01-preview' });
    } else {
        ttsClient = createAzureOpenAIClient(getTokenProvider());
    }

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
