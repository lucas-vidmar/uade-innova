/**
 * services/openai.js — Cliente Azure OpenAI
 * Standardized on DefaultAzureCredential for both local development (az login)
 * and Azure production (Managed Identity).
 */
import { AzureOpenAI } from 'openai';
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';

let _client = null;

function getClient() {
    if (!_client) {
        const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
        if (!endpoint) {
            throw new Error('AZURE_OPENAI_ENDPOINT is not defined in environment variables.');
        }

        // Use DefaultAzureCredential as the primary and only way to authenticate
        const credential = new DefaultAzureCredential();
        const scope = 'https://cognitiveservices.azure.com/.default';
        const azureADTokenProvider = getBearerTokenProvider(credential, scope);

        _client = new AzureOpenAI({
            endpoint,
            azureADTokenProvider,
            apiVersion: '2024-08-01-preview',
        });
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

    return response.data.map(d => d.embedding);
}

/**
 * Genera un embedding vectorial para un texto dado.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function generateEmbedding(text) {
    const embeddings = await generateEmbeddingsBatch([text]);
    return embeddings[0];
}

/**
 * Genera una respuesta de chat con contexto RAG.
 * @param {Array<{role: string, content: string}>} messages
 * @returns {Promise<string>}
 */
export async function chatCompletion(messages) {
    const client = getClient();
    const response = await client.chat.completions.create({
        model: process.env.AZURE_OPENAI_CHAT_DEPLOYMENT,
        messages,
        temperature: 0.3,
        max_tokens: 1500,
    });
    return response.choices[0].message.content;
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
        generatedAt: new Date().toISOString(),
        model: process.env.AZURE_OPENAI_CHAT_DEPLOYMENT
    };
}
