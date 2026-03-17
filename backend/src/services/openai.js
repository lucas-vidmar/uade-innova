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
