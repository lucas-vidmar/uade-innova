import { test, mock } from 'node:test';
import assert from 'node:assert';

// Mock Azure SDK modules to observe moveBlob copy+delete behavior (story 11.4.3).
const moveCalls = [];

const containerClients = {
    'class-materials': {
        getBlockBlobClient: (name) => ({
            exists: async () => true,
            download: async () => ({
                contentType: 'text/plain',
                readableStreamBody: (async function* () { yield Buffer.from('hello-soft-delete'); })(),
            }),
            getProperties: async () => ({ contentType: 'text/plain', metadata: { materialid: 'm1' } }),
            deleteIfExists: async () => { moveCalls.push({ op: 'delete-source', name }); return true; },
        }),
    },
    'deleted': {
        getBlockBlobClient: (name) => ({
            uploadData: async (buffer, options) => {
                moveCalls.push({ op: 'copy-to-dest', name, buffer, options });
            },
        }),
        createIfNotExists: async () => {},
    },
    'missing': {
        getBlockBlobClient: () => ({ exists: async () => false, deleteIfExists: async () => false }),
    },
};

const storageBlobMocks = {
    StorageSharedKeyCredential: class StorageSharedKeyCredential {
        constructor(accountName, key) { this.accountName = accountName; this.key = key; }
    },
    BlobServiceClient: class BlobServiceClient {
        getContainerClient(name) { return containerClients[name] || {}; }
    },
};

const dataTablesMocks = {
    TableClient: class TableClient {},
    AzureNamedKeyCredential: class AzureNamedKeyCredential {},
};

const identityMocks = {
    DefaultAzureCredential: class DefaultAzureCredential {},
};

mock.module('@azure/storage-blob', { namedExports: storageBlobMocks });
mock.module('@azure/data-tables', { namedExports: dataTablesMocks });
mock.module('@azure/identity', { namedExports: identityMocks });

process.env.AZURE_STORAGE_ACCOUNT_NAME = 'staccount';
process.env.AZURE_STORAGE_ACCESS_KEY = 'dev-key';
process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Development';

const { moveBlob } = await import('./storage.js');

test('moveBlob copies content+metadata to destination and deletes the source', async () => {
    const moved = await moveBlob('class-materials', 'arq-software-2026/mat-1.pdf', 'deleted', 'arq-software-2026/mat-1.pdf');

    assert.strictEqual(moved, true);

    const copy = moveCalls.find((c) => c.op === 'copy-to-dest');
    assert.ok(copy, 'should copy the blob to the destination container');
    assert.strictEqual(copy.name, 'arq-software-2026/mat-1.pdf');
    assert.strictEqual(copy.buffer.toString(), 'hello-soft-delete');
    assert.strictEqual(copy.options.blobHTTPHeaders.blobContentType, 'text/plain');
    assert.deepStrictEqual(copy.options.metadata, { materialid: 'm1' });

    const deleteSource = moveCalls.find((c) => c.op === 'delete-source');
    assert.ok(deleteSource, 'should delete the source blob after copying');
    assert.strictEqual(deleteSource.name, 'arq-software-2026/mat-1.pdf');
});

test('moveBlob returns false when the source blob does not exist', async () => {
    const moved = await moveBlob('missing', 'nope.txt', 'deleted', 'nope.txt');
    assert.strictEqual(moved, false);
});