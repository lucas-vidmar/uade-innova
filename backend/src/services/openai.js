/**
 * services/openai.js — Cliente Azure OpenAI
 * Usa API Key para desarrollo local; en producción usará Managed Identity.
 */
import { AzureOpenAI } from 'openai';

let _client = null;

function getClient() {
    if (!_client) {
        _client = new AzureOpenAI({
            endpoint: process.env.AZURE_OPENAI_ENDPOINT,
            apiKey: process.env.AZURE_OPENAI_API_KEY,
            apiVersion: '2024-08-01-preview',
        });
    }
    return _client;
}

/**
 * Genera un embedding vectorial para un texto dado.
 * Modelo: text-embedding-3-small → 1536 dimensiones
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function generateEmbedding(text) {
    const client = getClient();
    const response = await client.embeddings.create({
        model: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
        input: text.trim(),
    });
    return response.data[0].embedding;
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
