/**
 * services/openai.js — Cliente Azure OpenAI
 * Standardized on DefaultAzureCredential for both local development (az login)
 * and Azure production (Managed Identity).
 */
import { AzureOpenAI } from 'openai';
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import { CategorizedError, ErrorCategory } from './error-categories.js';

let _client = null;

function getClient() {
    if (!_client) {
        const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
        const apiKey = process.env.AZURE_OPENAI_KEY || process.env.AZURE_OPENAI_API_KEY;

        if (!endpoint) {
            throw new Error('AZURE_OPENAI_ENDPOINT is not defined in environment variables.');
        }

        const config = {
            endpoint,
            apiVersion: '2024-08-01-preview',
        };

        if (apiKey) {
            // Plan B: Use API Key (for environments with restricted RBAC/Managed Identity)
            config.apiKey = apiKey;
            console.log('[OpenAI] Authenticated using API Key');
        } else {
            // Plan A: Use DefaultAzureCredential (Managed Identity)
            const credential = new DefaultAzureCredential();
            const scope = 'https://cognitiveservices.azure.com/.default';
            config.azureADTokenProvider = getBearerTokenProvider(credential, scope);
            console.log('[OpenAI] Authenticated using DefaultAzureCredential');
        }

        _client = new AzureOpenAI(config);
    }
    return _client;
}

/**
 * Genera embeddings vectoriales para un array de textos (batch processing).
 * Modelo: text-embedding-3-small → 1536 dimensiones
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
export async function generateEmbeddingsBatch(texts) {
    const client = getClient();

    // Función de ayuda para reintentar con exponential backoff
    const executeWithRetry = async (fn, retries = 3, delay = 1000) => {
        try {
            return await fn();
        } catch (err) {
            const isRateLimit = err.status === 429 || err.message?.includes('Too Many Requests');
            if (retries > 0 && isRateLimit) {
                const nextDelay = delay * 2;
                console.warn(`[OpenAI] Rate limit alcanzado. Reintentando en ${delay}ms... (Intentos restantes: ${retries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return executeWithRetry(fn, retries - 1, nextDelay);
            }
            throw err;
        }
    };

    const response = await executeWithRetry(() =>
        client.embeddings.create({
            model: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
            input: texts.map(t => t.trim()),
        })
    );

    return {
        embeddings: response.data.map(d => d.embedding),
        usage: response.usage
    };
}

/**
 * Genera un embedding vectorial para un texto dado.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function generateEmbedding(text) {
    const { embeddings, usage } = await generateEmbeddingsBatch([text]);
    return { embedding: embeddings[0], usage };
}

/**
 * Genera una respuesta de chat con contexto RAG. Retorna contenido textual y desglose de tokens.
 * Si stream es true, retorna un async iterable.
 * @param {Array<{role: string, content: string}>} messages
 * @param {boolean} stream
 * @returns {Promise<{content: string, usage: object} | AsyncIterable<object>>}
 */
export async function chatCompletion(messages, stream = false, overrides = {}) {
    const client = getClient();
    const options = {
        model: process.env.AZURE_OPENAI_CHAT_DEPLOYMENT,
        messages,
        temperature: 0.3,
        max_tokens: 1500,
        stream,
        ...overrides,
    };

    try {
        if (stream) {
            // En modo stream, retornamos el iterador directamente
            return await client.chat.completions.create(options);
        }

        const response = await client.chat.completions.create(options);
        return {
            content: response.choices[0].message.content,
            usage: response.usage
        };
    } catch (err) {
        const text = `${err?.message || ''} ${err?.code || ''} ${err?.error?.code || ''}`.toLowerCase();
        if (text.includes('content_filter') || text.includes('safety') || text.includes('policy violation')) {
            throw new CategorizedError('La consulta fue bloqueada por politicas de seguridad del modelo.', {
                errorCategory: ErrorCategory.SAFETY,
                code: err?.code || err?.error?.code || 'SAFETY_BLOCKED',
                status: Number.isInteger(err?.status) ? err.status : 400,
                details: err?.error || null,
                cause: err,
            });
        }
        throw err;
    }
}
/**
 * Genera un resumen estructurado de una clase basándose en el texto extraído.
 * @param {string} text - Texto completo de la clase (transcripción o apuntes).
 * @param {string} subjectName - Nombre de la materia para contexto.
 * @returns {Promise<Object>} - Objeto con el resumen estructurado.
 */
export async function generateClassSummary(text, subjectName = "") {
    const client = getClient();
    const prompt = `
Eres un asistente académico experto en la Universidad Argentina de la Empresa (UADE). 
Tu tarea es generar un resumen estructurado de una clase universitaria basada en el texto proporcionado.

REGLAS DE FORMATO:
1. El resumen debe estar en ESPAÑOL.
2. Usa Markdown para el formato.
3. Divide el contenido en estas secciones:
   - **Temas Principales**: Lista con los 3-5 conceptos clave.
   - **Puntos Clave**: Explicación concisa de cada tema.
   - **Conclusión/Cierre**: Un párrafo resumen de la clase.

MATERIA: ${subjectName}
TEXTO DE LA CLASE:
${text.substring(0, 15000)} // Limitar para evitar exceder ventana de contexto de gpt-4o-mini

Resumen académico:`;

    const response = await client.chat.completions.create({
        model: process.env.AZURE_OPENAI_CHAT_DEPLOYMENT, // gpt-4o-mini
        messages: [
            { role: "system", content: "Generas resúmenes académicos estructurados y profesionales." },
            { role: "user", content: prompt }
        ],
        temperature: 0.5,
        max_tokens: 2000,
    });

    const content = response.choices[0].message.content;

    return {
        content,
        usage: response.usage,
        generatedAt: new Date().toISOString(),
        model: process.env.AZURE_OPENAI_CHAT_DEPLOYMENT
    };
}

/**
 * Genera un mapa conceptual en formato Mermaid.js basado en el texto de la clase.
 * @param {string} text - Texto de la clase.
 * @returns {Promise<Object>} - Objeto con el código Mermaid y metadatos.
 */
export async function generateClassMap(text) {
    const client = getClient();
    const prompt = `
Eres un experto en diseño instruccional y pedagogía visual.
Tu tarea es generar un mapa conceptual (Diagrama de Flujo) en formato Mermaid.js que organice visualmente los conceptos clave del texto proporcionado.

REGLAS:
1. Usa el formato Mermaid 'graph TD' (Top-Down).
2. Los nodos deben ser concisos (max 4 palabras).
3. Usa relaciones claras entre conceptos (ej: A -->|parte de| B).
4. El resultado debe ser EXCLUSIVAMENTE el código Mermaid, sin bloques de código markdown ni explicaciones.
5. Si el contenido es muy extenso, prioriza los 10 conceptos más importantes.

TEXTO DE LA CLASE:
${text.substring(0, 10000)}

Código Mermaid:`;

    const response = await client.chat.completions.create({
        model: process.env.AZURE_OPENAI_CHAT_DEPLOYMENT,
        messages: [
            { role: "system", content: "Generas diagramas Mermaid.js precisos y pedagógicos." },
            { role: "user", content: prompt }
        ],
        temperature: 0.4,
        max_tokens: 1500,
    });

    return {
        code: response.choices[0].message.content.replace(/```mermaid\n?|```/g, '').trim(),
        usage: response.usage,
        generatedAt: new Date().toISOString(),
    };
}

/**
 * Genera un archivo de audio (MP3) a partir de un texto dado.
 * @param {string} text - Texto a convertir a voz.
 * @param {string} voice - Voz a utilizar (alloy, echo, fabled, onyx, nova, shimmer).
 * @returns {Promise<Buffer>} - Buffer con el contenido del audio.
 */
export async function generateClassAudio(text, voice = 'nova') {
    const client = getClient();
    const response = await client.audio.speech.create({
        model: process.env.AZURE_OPENAI_TTS_DEPLOYMENT || 'tts-1',
        voice: voice,
        input: text.substring(0, 4000), // OpenAI TTS limit is 4096 characters per request
    });

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}
