import { test, mock } from 'node:test';
import assert from 'node:assert';

// Define mocks before importing
const authUtilsMocks = {
    validateFrontDoorId: mock.fn(() => true),
    parseClientPrincipal: mock.fn(() => ({ userRoles: [] }))
};

const storageMocks = {
    loadJson: mock.fn(async () => ({})),
    saveJson: mock.fn(async () => true),
    deleteBlob: mock.fn(async () => true),
    listBlobs: mock.fn(async () => []),
    getTableClient: mock.fn(() => ({
        listEntities: async function* () { }
    }))
};

// Mock dependencies
mock.module('../services/auth-utils.js', { namedExports: authUtilsMocks });
mock.module('../services/storage.js', { namedExports: storageMocks });
mock.module('../services/state-store.js', {
    namedExports: {
        listClassesBySubject: mock.fn(async () => []),
        listMaterialsBySubject: mock.fn(async () => []),
        replaceClassesForSubject: mock.fn(async () => true),
        deleteMaterialStateById: mock.fn(async () => true),
        getMaterialState: mock.fn(async () => null),
    }
});
mock.module('uuid', { namedExports: { v4: () => '1234' } });

// Capture multiple handlers since there are multiple routes
const handlers = {};
mock.module('@azure/functions', {
    namedExports: {
        app: {
            http: (name, options) => {
                handlers[name] = options.handler;
            }
        }
    }
});

// Import the function under test
await import('./classes-api.js');

test('classes-api save-class-map should return 403 for unauthorized users', async (t) => {
    // Reset mock to simulate unauthorized user
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Alumno'] }));
    
    // Default environment state isn't development to test roles
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = "Production";

    const mockContext = { log: mock.fn(), error: mock.fn() };
    const mockRequest = { params: { classId: 'test-class' } };

    const response = await handlers['save-class-map'](mockRequest, mockContext);
    assert.strictEqual(response.status, 403, 'Should return 403 Forbidden');
    
    const body = JSON.parse(response.body);
    assert.strictEqual(body.error, 'Forbidden - Teacher access required');

    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
});

test('classes-api save-class-map should return 200 for Docente', async (t) => {
    // Reset mock to simulate authorized user
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Docente'] }));
    
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = "Production";

    const mockContext = { log: mock.fn(), error: mock.fn() };
    const mockRequest = { 
        params: { classId: 'test-class' },
        json: async () => ({ mapCode: 'mock-map' })
    };

    const response = await handlers['save-class-map'](mockRequest, mockContext);
    assert.strictEqual(response.status, 200, 'Should return 200 OK');

    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
});

test('classes-api save-class-summary should require authorization', async (t) => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Guest'] }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = "Production";

    const mockContext = { log: mock.fn(), error: mock.fn() };
    const mockRequest = { params: { classId: '123' }, json: async () => ({ summary: 'test' }) };

    const response = await handlers['save-class-summary'](mockRequest, mockContext);
    assert.strictEqual(response.status, 403);

    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
});

test('classes-api delete-material should require authorization', async (t) => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: [] }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = "Production";

    const mockContext = { log: mock.fn(), error: mock.fn() };
    const mockRequest = { params: { materialId: '123' } };

    const response = await handlers['delete-material'](mockRequest, mockContext);
    assert.strictEqual(response.status, 403);

    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
});

test('classes-api save-classes should require authorization', async (t) => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: [] }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = "Production";

    const mockContext = { log: mock.fn(), error: mock.fn() };
    const mockRequest = { 
        query: new Map([['subjectId', 'test']]), 
        json: async () => ([]) 
    };

    const response = await handlers['save-classes'](mockRequest, mockContext);
    assert.strictEqual(response.status, 403);

    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
});

test('classes-api get-director-stats should require Director role', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Docente'] }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';

    const mockContext = { log: mock.fn(), error: mock.fn() };
    const mockRequest = { query: new Map() };

    const response = await handlers['get-director-stats'](mockRequest, mockContext);
    assert.strictEqual(response.status, 403);

    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
});

test('classes-api get-director-stats returns aggregate summary without student identifiers', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));

    const mockContext = { log: mock.fn(), error: mock.fn() };
    const mockRequest = { query: new Map() };

    const response = await handlers['get-director-stats'](mockRequest, mockContext);
    assert.strictEqual(response.status, 200);

    const payload = JSON.parse(response.body);
    assert.ok(payload.earlyAlertSummary);
    assert.strictEqual(typeof payload.earlyAlertSummary.totalStudentsAtRisk, 'number');
    assert.strictEqual(typeof payload.earlyAlertSummary.highRiskCount, 'number');
    assert.strictEqual(typeof payload.earlyAlertSummary.mediumRiskCount, 'number');

    assert.strictEqual(payload.name, undefined);
    assert.strictEqual(payload.studentId, undefined);
    assert.strictEqual(payload.subject, undefined);
});

test('classes-api get-director-powerbi-metrics should require Director role', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Docente'] }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';

    const mockContext = { log: mock.fn(), error: mock.fn() };
    const mockRequest = { query: new Map() };

    const response = await handlers['get-director-powerbi-metrics'](mockRequest, mockContext);
    assert.strictEqual(response.status, 403);

    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
});

test('classes-api get-director-powerbi-metrics returns aggregated daily metrics', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));

    const now = new Date();
    const todayIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 11, 0, 0)).toISOString();
    const yesterdayDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 10, 0, 0));
    const yesterdayIso = yesterdayDate.toISOString();
    const yesterdayIso2 = new Date(yesterdayDate.getTime() + 60 * 60 * 1000).toISOString();
    const anonTodayIso = new Date(new Date(todayIso).getTime() + 60 * 60 * 1000).toISOString();

    storageMocks.getTableClient.mock.mockImplementation(() => ({
        listEntities: async function* () {
            yield { userId: 'alu-001', totalTokens: 100, timestamp: yesterdayIso };
            yield { userId: 'alu-001', totalTokens: 200, timestamp: yesterdayIso2 };
            yield { userId: 'alu-002', totalTokens: 300, timestamp: todayIso };
            yield { userId: 'anonymous', totalTokens: 999, timestamp: anonTodayIso };
        },
    }));

    const mockContext = { log: mock.fn(), error: mock.fn() };
    const mockRequest = { query: new Map([['days', '2']]) };

    const response = await handlers['get-director-powerbi-metrics'](mockRequest, mockContext);
    assert.strictEqual(response.status, 200);

    const payload = JSON.parse(response.body);
    assert.strictEqual(payload.source.table, 'SessionMetrics');
    assert.strictEqual(payload.windowDays, 2);
    assert.ok(Array.isArray(payload.daily));
    assert.strictEqual(payload.daily.length, 2);

    const today = payload.daily[1];
    assert.strictEqual(today.totalTokens, 1299);
    assert.strictEqual(today.ragInteractions, 2);
    assert.strictEqual(today.dau, 1);
});
