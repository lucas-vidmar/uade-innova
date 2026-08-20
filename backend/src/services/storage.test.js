import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ─── Mocks ────────────────────────────────────────────────────────
const blobCalls = { fromConnectionString: [], ctor: [] };
const tableCalls = { fromConnectionString: [], ctor: [] };
let identityCtorCalls = 0;

mock.module('@azure/storage-blob', {
    namedExports: {
        BlobServiceClient: class BlobServiceClient {
            static fromConnectionString(cs) {
                blobCalls.fromConnectionString.push(cs);
                return { __kind: 'blob', via: 'connectionString', cs };
            }
            constructor(url, credential) {
                blobCalls.ctor.push({ url, credential });
                this.url = url;
                this.credential = credential;
            }
        },
        StorageSharedKeyCredential: class StorageSharedKeyCredential {
            constructor(name, key) { this.name = name; this.key = key; this.__kind = 'sharedKey'; }
        },
    },
});

mock.module('@azure/data-tables', {
    namedExports: {
        TableClient: class TableClient {
            static fromConnectionString(cs, tableName) {
                tableCalls.fromConnectionString.push({ cs, tableName });
                return { __kind: 'table', via: 'connectionString', cs, tableName };
            }
            constructor(url, tableName, credential) {
                if (credential === undefined && typeof tableName === 'string' && url.startsWith('http')) {
                    tableCalls.ctor.push({ url, tableName, credential: undefined });
                    this.url = url;
                    this.tableName = tableName;
                } else {
                    tableCalls.ctor.push({ url, tableName, credential });
                    this.url = url;
                    this.tableName = tableName;
                    this.credential = credential;
                }
            }
        },
        AzureNamedKeyCredential: class AzureNamedKeyCredential {
            constructor(name, key) { this.name = name; this.key = key; this.__kind = 'namedKey'; }
        },
    },
});

mock.module('@azure/identity', {
    namedExports: {
        DefaultAzureCredential: class DefaultAzureCredential {
            constructor() { identityCtorCalls++; this.__kind = 'identity'; }
        },
    },
});

const { getTableClient, getClient, _resetClientForTests } = await import('./storage.js');

function resetEnv() {
    delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    delete process.env.AZURE_STORAGE_ACCOUNT_NAME;
    delete process.env.AZURE_STORAGE_ACCESS_KEY;
    delete process.env.AZURE_FUNCTIONS_ENVIRONMENT;
}

beforeEach(() => {
    resetEnv();
    blobCalls.fromConnectionString.length = 0;
    blobCalls.ctor.length = 0;
    tableCalls.fromConnectionString.length = 0;
    tableCalls.ctor.length = 0;
    identityCtorCalls = 0;
    if (_resetClientForTests) _resetClientForTests();
});

afterEach(() => {
    resetEnv();
    if (_resetClientForTests) _resetClientForTests();
});

// ─── Table Tests ────────────────────────────────────────────────

test('Table prod con connectionString → fromConnectionString', () => {
    process.env.AZURE_STORAGE_CONNECTION_STRING = 'DefaultEndpointsProtocol=https;AccountName=testacc;AccountKey=key123;EndpointSuffix=core.windows.net';
    process.env.AZURE_STORAGE_ACCOUNT_NAME = 'testacc';
    process.env.AZURE_STORAGE_ACCESS_KEY = 'key123';
    const client = getTableClient('MyTable');
    assert.equal(tableCalls.fromConnectionString.length, 1);
    assert.equal(tableCalls.fromConnectionString[0].cs, process.env.AZURE_STORAGE_CONNECTION_STRING);
    assert.equal(tableCalls.fromConnectionString[0].tableName, 'MyTable');
    assert.equal(tableCalls.ctor.length, 0);
    assert.equal(identityCtorCalls, 0);
    assert.equal(client.via, 'connectionString');
});

test('Table prod con accountKey sin connectionString → AzureNamedKeyCredential', () => {
    process.env.AZURE_STORAGE_ACCOUNT_NAME = 'testacc';
    process.env.AZURE_STORAGE_ACCESS_KEY = 'key123';
    const client = getTableClient('MyTable');
    assert.equal(tableCalls.fromConnectionString.length, 0);
    assert.equal(tableCalls.ctor.length, 1);
    assert.ok(tableCalls.ctor[0].credential.__kind === 'namedKey');
    assert.equal(tableCalls.ctor[0].credential.name, 'testacc');
    assert.equal(tableCalls.ctor[0].credential.key, 'key123');
    assert.equal(identityCtorCalls, 0);
});

test('Table prod solo MI (solo accountName) → DefaultAzureCredential fallback', () => {
    process.env.AZURE_STORAGE_ACCOUNT_NAME = 'testacc';
    const client = getTableClient('MyTable');
    assert.equal(tableCalls.fromConnectionString.length, 0);
    assert.equal(tableCalls.ctor.length, 1);
    assert.ok(tableCalls.ctor[0].credential.__kind === 'identity');
    assert.equal(identityCtorCalls, 1);
});

test('Table prod connectionString tiene prioridad sobre accountKey', () => {
    process.env.AZURE_STORAGE_CONNECTION_STRING = 'DefaultEndpointsProtocol=https;AccountName=testacc;AccountKey=keyFromCS;EndpointSuffix=core.windows.net';
    process.env.AZURE_STORAGE_ACCOUNT_NAME = 'testacc';
    process.env.AZURE_STORAGE_ACCESS_KEY = 'differentKey';
    getTableClient('MyTable');
    assert.equal(tableCalls.fromConnectionString.length, 1);
    assert.equal(tableCalls.ctor.length, 0);
});

test('Table local Azurite UseDevelopmentStorage=true → fromConnectionString', () => {
    process.env.AZURE_STORAGE_CONNECTION_STRING = 'UseDevelopmentStorage=true';
    getTableClient('MyTable');
    assert.equal(tableCalls.fromConnectionString.length, 1);
    assert.equal(tableCalls.fromConnectionString[0].cs, 'UseDevelopmentStorage=true');
});

test('Table local AZURE_FUNCTIONS_ENVIRONMENT=Development con connectionString → fromConnectionString', () => {
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Development';
    process.env.AZURE_STORAGE_CONNECTION_STRING = 'UseDevelopmentStorage=true';
    getTableClient('MyTable');
    assert.equal(tableCalls.fromConnectionString.length, 1);
});

test('Table local AZURE_FUNCTIONS_ENVIRONMENT=Development sin connectionString → fallback 127.0.0.1:10002', () => {
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Development';
    process.env.AZURE_STORAGE_ACCOUNT_NAME = 'devstoreaccount1';
    const client = getTableClient('MyTable');
    assert.equal(tableCalls.fromConnectionString.length, 0);
    assert.equal(tableCalls.ctor.length, 1);
    assert.ok(tableCalls.ctor[0].url.includes('127.0.0.1:10002'));
});

test('Table sin accountName → throw', () => {
    assert.throws(() => getTableClient('MyTable'), /AZURE_STORAGE_ACCOUNT_NAME is not defined/);
});

test('Table UseDevelopmentStorage prefix no se trata como prod connectionString', () => {
    process.env.AZURE_STORAGE_CONNECTION_STRING = 'UseDevelopmentStorage=true';
    process.env.AZURE_STORAGE_ACCOUNT_NAME = 'testacc';
    process.env.AZURE_STORAGE_ACCESS_KEY = 'key123';
    getTableClient('MyTable');
    assert.equal(tableCalls.fromConnectionString.length, 1);
    assert.equal(tableCalls.fromConnectionString[0].cs, 'UseDevelopmentStorage=true');
    assert.equal(tableCalls.ctor.length, 0);
});

// ─── Blob Tests ────────────────────────────────────────────────
test('Blob prod con connectionString → fromConnectionString', () => {
    process.env.AZURE_STORAGE_CONNECTION_STRING = 'DefaultEndpointsProtocol=https;AccountName=testacc;AccountKey=key123;EndpointSuffix=core.windows.net';
    process.env.AZURE_STORAGE_ACCOUNT_NAME = 'testacc';
    process.env.AZURE_STORAGE_ACCESS_KEY = 'key123';
    const client = getClient();
    assert.equal(blobCalls.fromConnectionString.length, 1);
    assert.equal(blobCalls.fromConnectionString[0], process.env.AZURE_STORAGE_CONNECTION_STRING);
    assert.equal(blobCalls.ctor.length, 0);
    assert.equal(identityCtorCalls, 0);
    assert.equal(client.via, 'connectionString');
});

test('Blob prod con accountKey → StorageSharedKeyCredential', () => {
    process.env.AZURE_STORAGE_ACCOUNT_NAME = 'testacc';
    process.env.AZURE_STORAGE_ACCESS_KEY = 'key123';
    getClient();
    assert.equal(blobCalls.fromConnectionString.length, 0);
    assert.equal(blobCalls.ctor.length, 1);
    assert.equal(blobCalls.ctor[0].credential.__kind, 'sharedKey');
    assert.equal(blobCalls.ctor[0].credential.name, 'testacc');
});

test('Blob prod solo MI → DefaultAzureCredential', () => {
    process.env.AZURE_STORAGE_ACCOUNT_NAME = 'testacc';
    getClient();
    assert.equal(blobCalls.fromConnectionString.length, 0);
    assert.equal(blobCalls.ctor.length, 1);
    assert.equal(blobCalls.ctor[0].credential.__kind, 'identity');
    assert.equal(identityCtorCalls, 1);
});

test('Blob prod connectionString tiene prioridad sobre accountKey', () => {
    process.env.AZURE_STORAGE_CONNECTION_STRING = 'DefaultEndpointsProtocol=https;AccountName=testacc;AccountKey=keyFromCS;EndpointSuffix=core.windows.net';
    process.env.AZURE_STORAGE_ACCOUNT_NAME = 'testacc';
    process.env.AZURE_STORAGE_ACCESS_KEY = 'differentKey';
    getClient();
    assert.equal(blobCalls.fromConnectionString.length, 1);
    assert.equal(blobCalls.ctor.length, 0);
});

test('Blob local Azurite UseDevelopmentStorage=true → fromConnectionString', () => {
    process.env.AZURE_STORAGE_CONNECTION_STRING = 'UseDevelopmentStorage=true';
    getClient();
    assert.equal(blobCalls.fromConnectionString.length, 1);
    assert.equal(blobCalls.fromConnectionString[0], 'UseDevelopmentStorage=true');
});

test('Blob local AZURE_FUNCTIONS_ENVIRONMENT=Development sin connectionString con keys → Access Key (compat moveblob)', () => {
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Development';
    process.env.AZURE_STORAGE_ACCOUNT_NAME = 'devacc';
    process.env.AZURE_STORAGE_ACCESS_KEY = 'dev-key';
    getClient();
    // Debe priorizar Access Key sobre Azurite default cuando hay keys explícitas en Development
    assert.equal(blobCalls.ctor.length, 1);
    assert.equal(blobCalls.ctor[0].credential.__kind, 'sharedKey');
});

test('Blob sin accountName → throw', () => {
    assert.throws(() => getClient(), /AZURE_STORAGE_ACCOUNT_NAME is not defined/);
});

// ─── No leakage check ───────────────────────────────────────────
test('Logs no exponen valor de key', () => {
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    try {
        process.env.AZURE_STORAGE_ACCOUNT_NAME = 'testacc';
        process.env.AZURE_STORAGE_ACCESS_KEY = 'SUPER_SECRET_KEY_123';
        getTableClient('MyTable');
        const joined = logs.join(' ');
        assert.ok(!joined.includes('SUPER_SECRET_KEY_123'), 'log no debe contener el valor de la key');
    } finally {
        console.log = origLog;
    }
});
