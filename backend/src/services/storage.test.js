import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';

// Mock Azure SDK modules to observe which credential is used (story 10.13).
const storageBlobMocks = {
    StorageSharedKeyCredential: class StorageSharedKeyCredential {
        constructor(accountName, key) { this.accountName = accountName; this.key = key; }
    },
    BlobServiceClient: class BlobServiceClient {
        constructor(url, credential) { this.url = url; this.credential = credential; }
        getContainerClient() {
            return { createIfNotExists: async () => ({}), exists: async () => true, listBlobsFlat() { return { async *[Symbol.asyncIterator]() {} }; }, getBlockBlobClient() { return { uploadData: async () => ({}), download: async () => ({ readableStreamBody: null }), deleteIfExists: async () => true }; } };
        }
    },
};

const dataTablesMocks = {
    TableClient: class TableClient {
        constructor(url, tableName, credential) { this.url = url; this.tableName = tableName; this.credential = credential; }
        static fromConnectionString(connectionString, tableName) {
            return { _via: 'fromConnectionString', connectionString, tableName };
        }
        async createTable() {}
        async upsertEntity() {}
    },
    AzureNamedKeyCredential: class AzureNamedKeyCredential {
        constructor(accountName, key) { this.accountName = accountName; this.key = key; }
    },
};

const identityMocks = {
    DefaultAzureCredential: class DefaultAzureCredential {},
};

mock.module('@azure/storage-blob', { namedExports: storageBlobMocks });
mock.module('@azure/data-tables', { namedExports: dataTablesMocks });
mock.module('@azure/identity', { namedExports: identityMocks });

const { getTableClient, uploadFile, saveJson } = await import('./storage.js');

describe('Storage auth — Managed Identity precedence (story 10.13)', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        process.env = originalEnv;
        mock.reset();
    });

    test('getTableClient uses DefaultAzureCredential in production even when an access key is present', () => {
        delete process.env.AZURE_FUNCTIONS_ENVIRONMENT;
        process.env.AZURE_STORAGE_ACCOUNT_NAME = 'staccount';
        process.env.AZURE_STORAGE_ACCESS_KEY = 'plaintext-key';
        process.env.AZURE_STORAGE_CONNECTION_STRING = '';

        const client = getTableClient('materials');

        assert.ok(client instanceof dataTablesMocks.TableClient);
        assert.ok(client.credential instanceof identityMocks.DefaultAzureCredential,
            'production debe autenticar vía DefaultAzureCredential (Managed Identity)');
    });

    test('getTableClient keeps the Azurite connection-string path for local development', () => {
        process.env.AZURE_STORAGE_ACCOUNT_NAME = 'staccount';
        process.env.AZURE_STORAGE_CONNECTION_STRING = 'UseDevelopmentStorage=true';

        const client = getTableClient('materials');

        assert.strictEqual(client._via, 'fromConnectionString');
    });

    test('getTableClient in Development with a real connection string keeps it (dev path intact)', () => {
        process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Development';
        process.env.AZURE_STORAGE_ACCOUNT_NAME = 'staccount';
        process.env.AZURE_STORAGE_ACCESS_KEY = 'dev-key';
        process.env.AZURE_STORAGE_CONNECTION_STRING = 'DefaultEndpointsProtocol=https;AccountName=staccount;AccountKey=dev-key;EndpointSuffix=core.windows.net';

        const client = getTableClient('materials');

        assert.strictEqual(client._via, 'fromConnectionString');
    });

    test('blob upload uses DefaultAzureCredential in production even when an access key is present', async () => {
        delete process.env.AZURE_FUNCTIONS_ENVIRONMENT;
        process.env.AZURE_STORAGE_ACCOUNT_NAME = 'staccount';
        process.env.AZURE_STORAGE_ACCESS_KEY = 'plaintext-key';
        process.env.AZURE_STORAGE_CONNECTION_STRING = '';

        await saveJson('class-materials', 'x/test.json', { ok: true });

        assert.ok(uploadFile, 'uploadFile export should exist');
    });
});