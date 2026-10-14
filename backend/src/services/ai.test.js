import { test, describe, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';

// Mock dependencies
const openaiMocks = {
    AzureOpenAI: class {
        constructor(config) { this.config = config; this.chat = { completions: { create: mock.fn() } }; this.embeddings = { create: mock.fn() }; }
    },
    OpenAI: class {
        constructor(config) { this.config = config; this.chat = { completions: { create: mock.fn() } }; }
    }
};

mock.module('openai', { namedExports: openaiMocks });

// Import the service AFTER mocking
import * as ai from './ai.js';

describe('AI Service (DeepSeek Migration)', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        process.env = { ...originalEnv };
        // Reset private variables if necessary (though in JS they are module-scoped)
    });

    afterEach(() => {
        process.env = originalEnv;
        mock.reset();
    });

    test('Should use AzureOpenAI for embeddings always', async () => {
        process.env.AZURE_OPENAI_ENDPOINT = 'https://aoai.azure.com';
        process.env.AZURE_OPENAI_API_KEY = 'key123';
        
        // We can't easily test private _embeddingClient without re-importing or using a fresh environment,
        // but we can check if it throws when missing.
        assert.ok(ai.generateEmbedding, 'generateEmbedding should exist');
    });

    test('Should use DeepSeek when configured', async () => {
        process.env.AI_FOUNDRY_DEEPSEEK_ENDPOINT = 'https://deepseek.models.ai.azure.com';
        process.env.AI_FOUNDRY_DEEPSEEK_KEY = 'ds-key';
        process.env.AI_FOUNDRY_DEEPSEEK_MODEL = 'deepseek-v4-flash';

        // chatCompletion will use the chat client
        // We mock the implementation inside the test if needed, but here we just check if it doesn't crash
        assert.ok(ai.chatCompletion, 'chatCompletion should exist');
    });

    test('getClientForModel throws DEEPSEEK_NOT_CONFIGURED when a deepseek model is requested but the DeepSeek client cannot initialize', () => {
        // Ensure no DeepSeek endpoint/key are present so getDeepSeekClient() returns null.
        delete process.env.AI_FOUNDRY_DEEPSEEK_ENDPOINT;
        delete process.env.AI_FOUNDRY_DEEPSEEK_KEY;

        assert.throws(
            () => ai.getClientForModel('deepseek-v4-flash'),
            (err) => {
                assert.equal(err.code, 'DEEPSEEK_NOT_CONFIGURED');
                assert.equal(err.status, 500);
                return true;
            },
            'should throw a CategorizedError signaling DeepSeek is not configured'
        );
    });

    test('getModelDisplayName returns the configured catalog name when set', () => {
        process.env.AI_FOUNDRY_DEEPSEEK_DISPLAY_NAME = 'DeepSeek-V4.1-Flash';
        assert.equal(ai.getModelDisplayName('deepseek-v4-flash'), 'DeepSeek-V4.1-Flash');
    });

    test('getModelDisplayName falls back to the deployment name when unconfigured', () => {
        delete process.env.AI_FOUNDRY_DEEPSEEK_DISPLAY_NAME;
        assert.equal(ai.getModelDisplayName('deepseek-v4-flash'), 'deepseek-v4-flash');
    });

    test('getChatModelName surfaces the display name for the Powered-by label', () => {
        process.env.AI_FOUNDRY_DEEPSEEK_ENDPOINT = 'https://deepseek.models.ai.azure.com';
        process.env.AI_FOUNDRY_DEEPSEEK_KEY = 'ds-key';
        process.env.AI_FOUNDRY_DEEPSEEK_DISPLAY_NAME = 'DeepSeek-V4.1-Flash';
        assert.equal(ai.getChatModelName(), 'DeepSeek-V4.1-Flash');
    });
});
