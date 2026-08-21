/**
 * services/ai.js — Servicio Unificado de IA (Azure OpenAI + DeepSeek)
 * Maneja embeddings vía Azure OpenAI y generación de texto vía DeepSeek V4 Flash.
 */
import { AzureOpenAI, OpenAI } from 'openai';
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import { CategorizedError, ErrorCategory } from './error-categories.js';
import { extractMermaidCode } from './extract-mermaid.js';
import { getActivePrompt } from './prompts.js';
import { CONFIG } from '../config.js';

// ── Restore native web streams globals ─────────────────────
// Importing `openai` pulls in `web-streams-polyfill` (via formdata-node), whose
// polyfill entry replaces `globalThis.ReadableStream`/`WritableStream`/`TransformStream`.
// That breaks native `fetch` response body consumption (response.text()/.json()
// hang forever), killing every AI call. Restore the native `node:stream/web` classes.
const nativeStreams = await import('node:stream/web');
globalThis.ReadableStream = nativeStreams.ReadableStream;
globalThis.WritableStream = nativeStreams.WritableStream;
globalThis.TransformStream = nativeStreams.TransformStream;

const AOAI_TOKEN_SCOPE = CONFIG.ai.tokenScope;

let _embeddingClient = null;
let _chatClient = null;
let _deepSeekClient = null;
let _azureChatClient = null;
let _tokenProvider = null;

export function isDeepSeekModel(modelName) {
    return typeof modelName === 'string' && modelName.startsWith('deepseek');
}

export async function resolveModelForTask(taskType) {
    if (!taskType) return CONFIG.ai.deepSeekModel;
    try {
        const active = await getActivePrompt(taskType).catch(() => null);
        if (active?.model) return active.model;
    } catch {}
    return CONFIG.ai.models?.[taskType] || CONFIG.ai.deepSeekModel || 'deepseek-v4-flash';
}

function getTokenProvider() {
    if (!_tokenProvider) {
        const credential = new DefaultAzureCredential();
        const rawProvider = getBearerTokenProvider(credential, AOAI_TOKEN_SCOPE);
        _tokenProvider = async (options) => {
            try {
                return await rawProvider(options);
            } catch (err) {
                console.error('[AI] Failed to acquire Azure AD token for Azure OpenAI (Managed Identity). '
                    + 'Verify the Function App identity has the "Cognitive Services OpenAI User" role on the OpenAI account. '
                    + `Details: ${err?.message}`);
                throw err;
            }
        };
    }
    return _tokenProvider;
}

function createAzureOpenAIClient(azureAdTokenProvider) {
    return new AzureOpenAI({
        endpoint: process.env.AZURE_OPENAI_ENDPOINT,
        apiKey: process.env.AZURE_OPENAI_KEY || process.env.AZURE_OPENAI_API_KEY || undefined,
        azureADTokenProvider: azureAdTokenProvider,
        apiVersion: CONFIG.ai.apiVersion,
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
            _embeddingClient = new AzureOpenAI({ endpoint, apiKey, apiVersion: CONFIG.ai.apiVersion });
            console.log('[AI] Embedding Client (Azure OpenAI + API Key) initialized');
        } else {
            _embeddingClient = createAzureOpenAIClient(getTokenProvider());
            console.log('[AI] Embedding Client (Azure OpenAI + Managed Identity) initialized');
        }
    }
    return _embeddingClient;
}

function getDeepSeekClient() {
    if (_deepSeekClient) return _deepSeekClient;
    const dsEndpoint = CONFIG.ai.deepSeekEndpoint || process.env.AI_FOUNDRY_DEEPSEEK_ENDPOINT;
    const dsKey = process.env.AI_FOUNDRY_DEEPSEEK_KEY;
    if (!dsEndpoint || !dsKey) return null;
    _deepSeekClient = new OpenAI({
        baseURL: dsEndpoint.replace(/\/$/, ''),
        apiKey: dsKey,
        fetch: async (url, init) => {
            const headers = new Headers(init.headers);
            headers.set('api-key', dsKey);
            headers.delete('authorization');
            const parsedUrl = new URL(url);
            parsedUrl.searchParams.set('api-version', CONFIG.ai.apiVersion);
            return fetch(parsedUrl.toString(), { ...init, headers });
        },
    });
    console.log('[AI] Chat Client (DeepSeek V4 Flash via Azure AI Services) initialized');
    return _deepSeekClient;
}

function getAzureChatClient() {
    if (_azureChatClient) return _azureChatClient;
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    if (!endpoint) return null;
    const apiKey = process.env.AZURE_OPENAI_KEY || process.env.AZURE_OPENAI_API_KEY;
    if (apiKey) {
        _azureChatClient = new AzureOpenAI({ endpoint, apiKey, apiVersion: CONFIG.ai.apiVersion });
        console.log('[AI] Chat Client (Azure OpenAI + API Key) initialized');
    } else {
        _azureChatClient = createAzureOpenAIClient(getTokenProvider());
        console.log('[AI] Chat Client (Azure OpenAI + Managed Identity) initialized');
    }
    return _azureChatClient;
}

export function getClientForModel(modelName) {
    if (isDeepSeekModel(modelName)) {
        const ds = getDeepSeekClient();
        if (ds) return ds;
        throw new CategorizedError(
            `El modelo "${modelName}" requiere un cliente DeepSeek (Azure AI Services), pero AI_FOUNDRY_DEEPSEEK_ENDPOINT y/o AI_FOUNDRY_DEEPSEEK_KEY no estan configurados. Configura ambos (endpoint apuntando a aiservices-dashboard) para habilitar la inferencia DeepSeek.`,
            {
                errorCategory: ErrorCategory.INTERNAL,
                code: 'DEEPSEEK_NOT_CONFIGURED',
                status: 500,
            }
        );
    }
    const azure = getAzureChatClient();
    if (azure) return azure;
    // fallback to legacy generic client
    return getChatClient();
}

/**
 * Cliente para Generación (Azure AI Foundry - DeepSeek)
 * DeepSeek V4 Flash es compatible con la API de OpenAI.
 * Falls back to Azure OpenAI with Managed Identity if DeepSeek is not configured.
 */
function getChatClient() {
    if (!_chatClient) {
        const ds = getDeepSeekClient();
        if (ds) {
            _chatClient = ds;
        } else {
            const azure = getAzureChatClient();
            if (!azure) {
                throw new Error('No valid AI Chat configuration found (DeepSeek or Azure OpenAI).');
            }
            _chatClient = azure;
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

    const model = CONFIG.ai.embeddingModel;

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
    return !!((CONFIG.ai.deepSeekEndpoint || process.env.AI_FOUNDRY_DEEPSEEK_ENDPOINT) && process.env.AI_FOUNDRY_DEEPSEEK_KEY);
}

export function getChatModelName(taskType) {
    if (taskType && CONFIG.ai.models?.[taskType]) {
        return CONFIG.ai.models[taskType];
    }
    if (isChatUsingDeepSeek()) {
        return CONFIG.ai.deepSeekModel;
    }
    return process.env.AZURE_OPENAI_CHAT_DEPLOYMENT || CONFIG.ai.chatModel || 'gpt-4o-mini';
}

export async function getChatModelNameForTask(taskType) {
    return await resolveModelForTask(taskType);
}

/**
 * Chat Completion (Generación de respuestas)
 * Usa DeepSeek V4 Flash por defecto si está configurado.
 * Soporta selección de modelo por tarea vía overrides.model
 */
export async function chatCompletion(messages, stream = false, overrides = {}) {
    const { headers, signal, model: overrideModel, ...modelOverrides } = overrides || {};
    const requestedModel = overrideModel || null;
    const model = requestedModel || (isChatUsingDeepSeek() ? CONFIG.ai.deepSeekModel : (process.env.AZURE_OPENAI_CHAT_DEPLOYMENT || CONFIG.ai.chatModel || 'gpt-4o-mini'));
    const client = getClientForModel(model);

    const options = {
        model,
        messages,
        temperature: CONFIG.ai.temperature.chat,
        max_tokens: CONFIG.ai.maxTokens.chat,
        stream,
        ...modelOverrides,
    };
    // ensure explicit model override wins even if modelOverrides contains model
    if (requestedModel) options.model = requestedModel;

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
    const model = options.model || promptConfig?.model || await resolveModelForTask('class-summary');

    const response = await chatCompletion([
        { role: "system", content: systemContent },
        { role: "user", content: userContent }
    ], false, { model, temperature: options.temperature ?? CONFIG.ai.temperature.summary, max_tokens: CONFIG.ai.maxTokens.summary, headers: options.headers });

    return {
        content: response.content,
        usage: response.usage,
        generatedAt: new Date().toISOString(),
        model
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
    const model = options.model || promptConfig?.model || await resolveModelForTask('mermaid');

    const response = await chatCompletion([
        { role: "system", content: systemContent },
        { role: "user", content: userContent }
    ], false, { model, temperature: CONFIG.ai.temperature.mermaid, max_tokens: CONFIG.ai.maxTokens.mermaid, headers: options.headers });

    return {
        code: extractMermaidCode(response.content),
        usage: response.usage,
        generatedAt: new Date().toISOString(),
        model,
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
    const model = options.model || promptConfig?.model || await resolveModelForTask('class-podcast');

    const response = await chatCompletion([
        { role: "system", content: systemContent },
        { role: "user", content: userContent }
    ], false, { model, temperature: CONFIG.ai.temperature.podcast, max_tokens: CONFIG.ai.maxTokens.podcast, headers: options.headers });

    return {
        content: response.content,
        usage: response.usage,
        generatedAt: new Date().toISOString(),
        model
    };
}

/**
 * Genera audio (TTS)
 * DeepSeek no suele tener TTS, mantenemos Azure OpenAI.
 */
export async function generateClassAudio(text, voice = CONFIG.ai.defaultVoice, options = {}) {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    if (!endpoint) throw new Error('AZURE_OPENAI_ENDPOINT is required for TTS.');

    const apiKey = process.env.AZURE_OPENAI_KEY || process.env.AZURE_OPENAI_API_KEY;
    let ttsClient;
    if (apiKey) {
        ttsClient = new AzureOpenAI({ endpoint, apiKey, apiVersion: CONFIG.ai.apiVersion });
    } else {
        ttsClient = createAzureOpenAIClient(getTokenProvider());
    }

    const response = await ttsClient.audio.speech.create(
        {
            model: CONFIG.ai.ttsModel,
            voice,
            input: text.substring(0, CONFIG.ai.maxTokens.ttsInput),
        },
        { headers: options.headers }
    );

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}
