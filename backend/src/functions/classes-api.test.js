import { test, mock } from 'node:test';
import assert from 'node:assert';

// Define mocks before importing
const authUtilsMocks = {
    validateFrontDoorId: mock.fn(() => true),
    setStashedIdentity: mock.fn(() => {}),
    parseClientPrincipal: mock.fn(() => ({ userRoles: [] }))
};

function applyODataFilter(entities, options) {
    const filterStr = options?.queryOptions?.filter;
    if (!filterStr) return entities;
    const parts = filterStr.split(' and ');
    return entities.filter(entity => {
        for (const part of parts) {
            const m = part.match(/(\w+)\s+(ne|eq)\s+'([^']*)'/);
            if (!m) continue;
            const [, field, op, value] = m;
            const entityVal = String(entity[field] || '').trim();
            if (op === 'ne' && entityVal === value) return false;
            if (op === 'eq' && entityVal !== value) return false;
        }
        return true;
    });
}

function makeListEntitiesResult(entities) {
    let _lastOptions = null;
    const iterable = {
        [Symbol.asyncIterator]: async function* () {
            for (const e of entities) yield e;
        },
        byPage: async function* (pageOptions) {
            const filtered = applyODataFilter(entities, _lastOptions);
            const page = [...filtered];
            page.continuationToken = null;
            yield page;
        }
    };
    const listFn = (options) => {
        _lastOptions = options || null;
        return iterable;
    };
    listFn._iterable = iterable;
    return listFn;
}

const defaultListEntities = makeListEntitiesResult([]);

const storageMocks = {
    loadJson: mock.fn(async () => ({})),
    saveJson: mock.fn(async () => true),
    deleteBlob: mock.fn(async () => true),
    listBlobs: mock.fn(async () => []),
    getTableClient: mock.fn(() => ({
        listEntities: defaultListEntities
    })),
    uploadFile: mock.fn(async () => true),
    downloadFile: mock.fn(async () => null),
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
        upsertMaterialState: mock.fn(async () => true),
        deleteClassesBySubject: mock.fn(async () => true),
        deleteMaterialsBySubject: mock.fn(async () => true),
        getEnrollmentsByUser: mock.fn(async () => []),
        getEnrollment: mock.fn(async () => null),
        listMaterialsByClass: mock.fn(async () => []),
        listClassViewsByStudent: mock.fn(async () => []),
        deleteClassViewsBySubject: mock.fn(async () => true),
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

// Set required env var before importing module that validates it at load time
process.env.DIRECTOR_BUDGET_MONTHLY_USD = '97.50';

// Azure Functions context.log is a callable function with .warn/.error/.info methods
function makeMockLog() {
    const log = mock.fn();
    log.warn = mock.fn();
    log.error = mock.fn();
    log.info = mock.fn();
    log.metric = mock.fn();
    return log;
}

// Import the function under test
await import('./classes-api.js');

test('classes-api save-class-map should return 403 for unauthorized users', async (t) => {
    // Reset mock to simulate unauthorized user
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Alumno'] }));
    
    // Default environment state isn't development to test roles
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = "Production";

    const mockContext = { log: makeMockLog(), error: mock.fn() };
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

    const mockContext = { log: makeMockLog(), error: mock.fn() };
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

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: { classId: '123' }, json: async () => ({ summary: 'test' }) };

    const response = await handlers['save-class-summary'](mockRequest, mockContext);
    assert.strictEqual(response.status, 403);

    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
});

test('classes-api delete-material should require authorization', async (t) => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: [] }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = "Production";

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: { materialId: '123' } };

    const response = await handlers['delete-material'](mockRequest, mockContext);
    assert.strictEqual(response.status, 403);

    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
});

test('classes-api save-classes should require authorization', async (t) => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: [] }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = "Production";

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { 
        params: {},
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

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: {}, query: new Map() };

    const response = await handlers['get-director-stats'](mockRequest, mockContext);
    assert.strictEqual(response.status, 403);

    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
});

test('classes-api get-director-stats returns aggregate summary without student identifiers', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: {}, query: new Map() };

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

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: {}, query: new Map() };

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
        listEntities: makeListEntitiesResult([
            { userId: 'alu-001', promptTokens: 100, completionTokens: 50, totalTokens: 150, timestamp: yesterdayIso },
            { userId: 'alu-001', promptTokens: 120, completionTokens: 80, totalTokens: 200, timestamp: yesterdayIso2 },
            { userId: 'alu-002', promptTokens: 200, completionTokens: 100, totalTokens: 300, timestamp: todayIso },
            { userId: 'anonymous', promptTokens: 500, completionTokens: 499, totalTokens: 999, timestamp: anonTodayIso },
        ])
    }));

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: {}, query: new Map([['days', '2']]) };

    const response = await handlers['get-director-powerbi-metrics'](mockRequest, mockContext);
    assert.strictEqual(response.status, 200);

    const payload = JSON.parse(response.body);
    assert.strictEqual(payload.source.table, 'SessionMetrics');
    assert.strictEqual(payload.windowDays, 2);
    assert.strictEqual(payload.pricing.inputPerMillionTokensUsd, 0.15);
    assert.strictEqual(payload.pricing.outputPerMillionTokensUsd, 0.60);
    assert.ok(Array.isArray(payload.daily));
    assert.strictEqual(payload.daily.length, 2);

    const today = payload.daily[1];
    assert.strictEqual(today.promptTokens, 700);
    assert.strictEqual(today.completionTokens, 599);
    assert.strictEqual(today.totalTokens, 1299);
    assert.strictEqual(today.totalCost, 0.000464);
    assert.strictEqual(today.avgCostPerInteraction, 0.0002322);
    assert.strictEqual(today.ragInteractions, 2);
    assert.strictEqual(today.dau, 1);

    assert.strictEqual(payload.summary.totalPromptTokens, 920);
    assert.strictEqual(payload.summary.totalCompletionTokens, 729);
    assert.strictEqual(payload.summary.totalTokens, 1649);
    assert.strictEqual(payload.summary.totalInteractions, 4);
    assert.strictEqual(payload.summary.totalCostUsd, 0.000575);
    assert.strictEqual(payload.summary.avgCostPerInteractionUsd, 0.00014375);
});

test('classes-api get-director-stats returns costBySubject with subject-level breakdown', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));

    const yesterdayIso = new Date(Date.now() - 86400000).toISOString();
    const todayIso = new Date().toISOString();

    storageMocks.getTableClient.mock.mockImplementation(() => ({
        listEntities: makeListEntitiesResult([
            { userId: 'alu-001', promptTokens: 100, completionTokens: 50, totalTokens: 150, subjectId: 'arq-software-2026', timestamp: yesterdayIso },
            { userId: 'alu-002', promptTokens: 200, completionTokens: 100, totalTokens: 300, subjectId: 'diseno-bd-2026', timestamp: yesterdayIso },
            { userId: 'alu-001', promptTokens: 50, completionTokens: 25, totalTokens: 75, subjectId: 'arq-software-2026', timestamp: todayIso },
        ])
    }));

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: {}, query: new Map() };

    const response = await handlers['get-director-stats'](mockRequest, mockContext);
    assert.strictEqual(response.status, 200);

    const payload = JSON.parse(response.body);
    assert.ok(Array.isArray(payload.costBySubject), 'costBySubject should be an array');
    assert.ok(payload.costBySubject.length > 0, 'costBySubject should have entries');
    assert.ok(payload.costBySubject.some(s => s.subjectId === 'arq-software-2026'), 'should include arq-software-2026');
    assert.ok(payload.costBySubject.some(s => s.subjectId === 'diseno-bd-2026'), 'should include diseno-bd-2026');

    const arq = payload.costBySubject.find(s => s.subjectId === 'arq-software-2026');
    assert.ok(Array.isArray(arq.dailyCost), 'dailyCost should be an array');
    assert.ok(arq.dailyCost.length > 0, 'dailyCost should have entries');
    assert.strictEqual(typeof arq.dailyCost[0].cost, 'number', 'cost should be a number');
});

test('classes-api get-director-stats returns wausBySubject with weekly user counts', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));

    const yesterdayIso = new Date(Date.now() - 86400000).toISOString();

    storageMocks.getTableClient.mock.mockImplementation(() => ({
        listEntities: makeListEntitiesResult([
            { userId: 'alu-001', promptTokens: 100, completionTokens: 50, totalTokens: 150, subjectId: 'arq-software-2026', timestamp: yesterdayIso },
            { userId: 'alu-002', promptTokens: 200, completionTokens: 100, totalTokens: 300, subjectId: 'arq-software-2026', timestamp: yesterdayIso },
            { userId: 'alu-003', promptTokens: 50, completionTokens: 25, totalTokens: 75, subjectId: 'diseno-bd-2026', timestamp: yesterdayIso },
        ])
    }));

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: {}, query: new Map() };

    const response = await handlers['get-director-stats'](mockRequest, mockContext);
    assert.strictEqual(response.status, 200);

    const payload = JSON.parse(response.body);
    assert.ok(Array.isArray(payload.wausBySubject), 'wausBySubject should be an array');
    const arq = payload.wausBySubject.find(w => w.subjectId === 'arq-software-2026');
    assert.ok(arq, 'should include arq-software-2026');
    assert.strictEqual(typeof arq.currentWeek, 'number', 'currentWeek should be a number');
});

test('classes-api get-director-stats returns materialUploads with teacher breakdown', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));
    const todayIso = new Date().toISOString();

    storageMocks.getTableClient.mock.mockImplementation(() => ({
        listEntities: makeListEntitiesResult([
            { eventType: 'material-upload', teacherId: 'doc-001', userId: 'doc-001', materialType: 'transcript', filename: 'clase.vtt', subjectId: 'arq-software-2026', timestamp: todayIso },
            { eventType: 'material-upload', teacherId: 'doc-001', userId: 'doc-001', materialType: 'presentation', filename: 'clase.pptx', subjectId: 'arq-software-2026', timestamp: todayIso },
            { eventType: 'material-upload', teacherId: 'doc-002', userId: 'doc-002', materialType: 'notes', filename: 'apuntes.docx', subjectId: 'diseno-bd-2026', timestamp: todayIso },
        ])
    }));

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: {}, query: new Map() };

    const response = await handlers['get-director-stats'](mockRequest, mockContext);
    assert.strictEqual(response.status, 200);

    const payload = JSON.parse(response.body);
    assert.ok(payload.materialUploads, 'materialUploads should exist');
    assert.ok(Array.isArray(payload.materialUploads.byTeacher), 'byTeacher should be an array');
    assert.strictEqual(payload.materialUploads.byTeacher.length, 2, 'should have 2 teachers');

    const doc1 = payload.materialUploads.byTeacher.find(t => t.teacherId === 'doc-001');
    assert.ok(doc1, 'should include doc-001');
    assert.strictEqual(doc1.transcripts, 1, 'doc-001 should have 1 transcript');
    assert.strictEqual(doc1.total, 2, 'doc-001 should have 2 total uploads');
});

test('classes-api get-director-stats returns budget object with projection', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));
    const prevBudget = process.env.DIRECTOR_BUDGET_MONTHLY_USD;
    process.env.DIRECTOR_BUDGET_MONTHLY_USD = '97.50';

    const todayIso = new Date().toISOString();
    const yesterdayIso = new Date(Date.now() - 86400000).toISOString();

    storageMocks.getTableClient.mock.mockImplementation(() => ({
        listEntities: makeListEntitiesResult([
            { userId: 'alu-001', promptTokens: 1000, completionTokens: 500, totalTokens: 1500, timestamp: yesterdayIso },
            { userId: 'alu-001', promptTokens: 2000, completionTokens: 1000, totalTokens: 3000, timestamp: todayIso },
        ])
    }));

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: {}, query: new Map() };

    const response = await handlers['get-director-stats'](mockRequest, mockContext);
    assert.strictEqual(response.status, 200);

    const payload = JSON.parse(response.body);
    assert.ok(payload.budget, 'budget object should exist');
    assert.strictEqual(payload.budget.monthlyLimit, 97.50, 'monthlyLimit should be 97.50');
    assert.strictEqual(typeof payload.budget.currentSpend, 'number', 'currentSpend should be a number');
    assert.strictEqual(typeof payload.budget.projectedEndOfMonth, 'number', 'projectedEndOfMonth should be a number');
    assert.strictEqual(typeof payload.budget.percentUsed, 'number', 'percentUsed should be a number');
    assert.ok(['none', 'warning', 'critical'].includes(payload.budget.warningLevel), 'warningLevel should be valid');

    process.env.DIRECTOR_BUDGET_MONTHLY_USD = prevBudget;
});

test('classes-api get-director-stats returns costPerActiveStudent', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));
    const todayIso = new Date().toISOString();

    storageMocks.getTableClient.mock.mockImplementation(() => ({
        listEntities: makeListEntitiesResult([
            { userId: 'alu-001', promptTokens: 100, completionTokens: 50, totalTokens: 150, timestamp: todayIso },
            { userId: 'alu-002', promptTokens: 200, completionTokens: 100, totalTokens: 300, timestamp: todayIso },
        ])
    }));

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: {}, query: new Map() };

    const response = await handlers['get-director-stats'](mockRequest, mockContext);
    assert.strictEqual(response.status, 200);

    const payload = JSON.parse(response.body);
    assert.strictEqual(typeof payload.costPerActiveStudent, 'number', 'costPerActiveStudent should be a number');
    assert.ok(payload.costPerActiveStudent >= 0, 'costPerActiveStudent should be >= 0');
});

test('classes-api get-director-powerbi-metrics returns costBySubject array', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));
    const yesterdayIso = new Date(Date.now() - 86400000).toISOString();

    storageMocks.getTableClient.mock.mockImplementation(() => ({
        listEntities: makeListEntitiesResult([
            { userId: 'alu-001', promptTokens: 100, completionTokens: 50, totalTokens: 150, subjectId: 'arq-software-2026', timestamp: yesterdayIso },
        ])
    }));

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: {}, query: new Map([['days', '3']]) };

    const response = await handlers['get-director-powerbi-metrics'](mockRequest, mockContext);
    assert.strictEqual(response.status, 200);

    const payload = JSON.parse(response.body);
    assert.ok(Array.isArray(payload.costBySubject), 'costBySubject should be an array');
    assert.ok(payload.costBySubject.length > 0, 'costBySubject should not be empty');

    const first = payload.costBySubject[0];
    assert.ok(first.subjectId, 'subjectId should exist');
    assert.ok(Array.isArray(first.dailyCost), 'dailyCost should be an array');
    assert.strictEqual(typeof first.dailyCost[0].cost, 'number', 'cost should be a number');
});

test('classes-api get-director-powerbi-metrics costByClass respects subjectId filter', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));
    const yesterdayIso = new Date(Date.now() - 86400000).toISOString();

    storageMocks.getTableClient.mock.mockImplementation(() => ({
        listEntities: makeListEntitiesResult([
            { userId: 'alu-001', promptTokens: 100, completionTokens: 50, totalTokens: 150, subjectId: 'arq-software-2026', classId: 'class-01', timestamp: yesterdayIso },
            { userId: 'alu-002', promptTokens: 200, completionTokens: 100, totalTokens: 300, subjectId: 'diseno-bd-2026', classId: 'class-02', timestamp: yesterdayIso },
            { eventType: 'material-upload', teacherId: 'doc-001', subjectId: 'arq-software-2026', classId: 'class-01', timestamp: yesterdayIso },
        ])
    }));

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: {}, query: new Map([['subjectId', 'arq-software-2026'], ['days', '3']]) };

    const response = await handlers['get-director-powerbi-metrics'](mockRequest, mockContext);
    assert.strictEqual(response.status, 200);

    const payload = JSON.parse(response.body);
    assert.ok(Array.isArray(payload.costByClass), 'costByClass should be an array');
    assert.strictEqual(payload.costByClass.length, 1, 'costByClass should have exactly 1 entry for arq-software-2026');
    assert.strictEqual(payload.costByClass[0].classId, 'class-01', 'classId should be class-01');
    assert.ok(payload.costByClass[0].cost > 0, 'cost should be positive');
    assert.strictEqual(payload.costByClass[0].interactions, 1, 'interactions should exclude material-upload');
});

test('classes-api get-director-session-metrics-history returns all rows when no subjectId', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));
    const yesterdayIso = new Date(Date.now() - 86400000).toISOString();

    storageMocks.getTableClient.mock.mockImplementation(() => ({
        listEntities: makeListEntitiesResult([
            { userId: 'alu-001', promptTokens: 100, completionTokens: 50, totalTokens: 150, subjectId: 'arq-software-2026', classId: 'class-01', timestamp: yesterdayIso },
            { userId: 'alu-002', promptTokens: 200, completionTokens: 100, totalTokens: 300, subjectId: 'diseno-bd-2026', classId: 'class-02', timestamp: yesterdayIso },
        ])
    }));

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: {}, query: new Map() };

    const response = await handlers['get-director-session-metrics-history'](mockRequest, mockContext);
    assert.strictEqual(response.status, 200);

    const payload = JSON.parse(response.body);
    assert.ok(Array.isArray(payload.history), 'history should be an array');
    assert.strictEqual(payload.total, 2, 'should return 2 rows');
    assert.strictEqual(payload.history[0].subjectId, 'arq-software-2026');
    assert.strictEqual(payload.history[1].subjectId, 'diseno-bd-2026');
    assert.strictEqual(payload.history[0].userId, undefined, 'should not expose userId');
    assert.strictEqual(payload.continuationToken, null, 'should have null continuationToken');
    assert.strictEqual(payload.hasMore, false, 'should have hasMore false');
});

test('classes-api get-director-session-metrics-history filters by subjectId', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));
    const yesterdayIso = new Date(Date.now() - 86400000).toISOString();

    storageMocks.getTableClient.mock.mockImplementation(() => ({
        listEntities: makeListEntitiesResult([
            { userId: 'alu-001', promptTokens: 100, completionTokens: 50, totalTokens: 150, subjectId: 'arq-software-2026', classId: 'class-01', timestamp: yesterdayIso },
            { userId: 'alu-002', promptTokens: 200, completionTokens: 100, totalTokens: 300, subjectId: 'diseno-bd-2026', classId: 'class-02', timestamp: yesterdayIso },
        ])
    }));

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: {}, query: new Map([['subjectId', 'arq-software-2026']]) };

    const response = await handlers['get-director-session-metrics-history'](mockRequest, mockContext);
    assert.strictEqual(response.status, 200);

    const payload = JSON.parse(response.body);
    assert.strictEqual(payload.total, 1, 'should return 1 row');
    assert.strictEqual(payload.history[0].subjectId, 'arq-software-2026');
});

test('classes-api get-director-session-metrics-history returns empty for non-existent subjectId', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));
    const yesterdayIso = new Date(Date.now() - 86400000).toISOString();

    storageMocks.getTableClient.mock.mockImplementation(() => ({
        listEntities: makeListEntitiesResult([
            { userId: 'alu-001', promptTokens: 100, completionTokens: 50, totalTokens: 150, subjectId: 'arq-software-2026', classId: 'class-01', timestamp: yesterdayIso },
        ])
    }));

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: {}, query: new Map([['subjectId', 'nonexistent']]) };

    const response = await handlers['get-director-session-metrics-history'](mockRequest, mockContext);
    assert.strictEqual(response.status, 200);

    const payload = JSON.parse(response.body);
    assert.strictEqual(payload.total, 0, 'should return 0 rows');
    assert.strictEqual(payload.history.length, 0);
});

test('classes-api get-director-session-metrics-history excludes material-upload events', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));
    const yesterdayIso = new Date(Date.now() - 86400000).toISOString();

    storageMocks.getTableClient.mock.mockImplementation(() => ({
        listEntities: makeListEntitiesResult([
            { userId: 'alu-001', promptTokens: 100, completionTokens: 50, totalTokens: 150, subjectId: 'arq-software-2026', classId: 'class-01', timestamp: yesterdayIso },
            { eventType: 'material-upload', teacherId: 'doc-001', subjectId: 'arq-software-2026', classId: 'class-01', timestamp: yesterdayIso },
        ])
    }));

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: {}, query: new Map() };

    const response = await handlers['get-director-session-metrics-history'](mockRequest, mockContext);
    assert.strictEqual(response.status, 200);

    const payload = JSON.parse(response.body);
    assert.strictEqual(payload.total, 1, 'should exclude material-upload event');
    assert.strictEqual(payload.history[0].promptTokens, 100);
});

test('classes-api get-director-session-metrics-history returns empty array when no data', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));

    storageMocks.getTableClient.mock.mockImplementation(() => ({
        listEntities: makeListEntitiesResult([])
    }));

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: {}, query: new Map() };

    const response = await handlers['get-director-session-metrics-history'](mockRequest, mockContext);
    assert.strictEqual(response.status, 200);

    const payload = JSON.parse(response.body);
    assert.strictEqual(payload.total, 0);
    assert.strictEqual(payload.history.length, 0);
});

test('classes-api get-director-session-metrics-history returns 403 for non-Director role', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Docente'] }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: {}, query: new Map() };

    const response = await handlers['get-director-session-metrics-history'](mockRequest, mockContext);
    assert.strictEqual(response.status, 403);

    const body = JSON.parse(response.body);
    assert.strictEqual(body.error, 'Forbidden - Director access required');

    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
});

test('classes-api get-director-session-metrics-history returns 403 when Front Door validation fails', async () => {
    authUtilsMocks.validateFrontDoorId.mock.mockImplementation(() => false);

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: {}, query: new Map() };

    const response = await handlers['get-director-session-metrics-history'](mockRequest, mockContext);
    assert.strictEqual(response.status, 403);

    const body = JSON.parse(response.body);
    assert.strictEqual(body.error, 'Forbidden - Invalid Front Door ID');

    authUtilsMocks.validateFrontDoorId.mock.mockImplementation(() => true);
});

test('classes-api get-director-session-metrics-history trims whitespace from subjectId query param', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));
    const yesterdayIso = new Date(Date.now() - 86400000).toISOString();

    storageMocks.getTableClient.mock.mockImplementation(() => ({
        listEntities: makeListEntitiesResult([
            { userId: 'alu-001', promptTokens: 100, completionTokens: 50, totalTokens: 150, subjectId: 'arq-software-2026', classId: 'class-01', timestamp: yesterdayIso },
            { userId: 'alu-002', promptTokens: 200, completionTokens: 100, totalTokens: 300, subjectId: 'diseno-bd-2026', classId: 'class-02', timestamp: yesterdayIso },
        ])
    }));

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: {}, query: new Map([['subjectId', '  arq-software-2026  ']]) };

    const response = await handlers['get-director-session-metrics-history'](mockRequest, mockContext);
    assert.strictEqual(response.status, 200);

    const payload = JSON.parse(response.body);
    assert.strictEqual(payload.total, 1, 'should match after trimming whitespace');
    assert.strictEqual(payload.history[0].subjectId, 'arq-software-2026');
});

test('classes-api get-director-session-metrics-history paginates with default limit', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));
    const yesterdayIso = new Date(Date.now() - 86400000).toISOString();

    storageMocks.getTableClient.mock.mockImplementation(() => ({
        listEntities: makeListEntitiesResult([
            { userId: 'alu-001', promptTokens: 100, completionTokens: 50, totalTokens: 150, subjectId: 'arq-software-2026', classId: 'class-01', timestamp: yesterdayIso },
            { userId: 'alu-002', promptTokens: 200, completionTokens: 100, totalTokens: 300, subjectId: 'diseno-bd-2026', classId: 'class-02', timestamp: yesterdayIso },
        ])
    }));

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: {}, query: new Map() };

    const response = await handlers['get-director-session-metrics-history'](mockRequest, mockContext);
    assert.strictEqual(response.status, 200);

    const payload = JSON.parse(response.body);
    assert.strictEqual(payload.total, 2);
    assert.strictEqual(payload.continuationToken, null);
    assert.strictEqual(payload.hasMore, false);
});

test('classes-api get-director-session-metrics-history returns 400 for invalid continuationToken', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));

    storageMocks.getTableClient.mock.mockImplementation(() => ({
        listEntities: makeListEntitiesResult([])
    }));

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: {}, query: new Map([['continuationToken', 'not-valid-base64']]) };

    const response = await handlers['get-director-session-metrics-history'](mockRequest, mockContext);
    assert.strictEqual(response.status, 400);

    const payload = JSON.parse(response.body);
    assert.strictEqual(payload.error, 'Invalid continuation token');
});

test('classes-api get-director-session-metrics-history limit clamps to max 1000', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));
    const yesterdayIso = new Date(Date.now() - 86400000).toISOString();

    storageMocks.getTableClient.mock.mockImplementation(() => ({
        listEntities: makeListEntitiesResult([
            { userId: 'alu-001', promptTokens: 100, completionTokens: 50, totalTokens: 150, subjectId: 'arq-software-2026', classId: 'class-01', timestamp: yesterdayIso },
        ])
    }));

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: {}, query: new Map([['limit', '9999']]) };

    const response = await handlers['get-director-session-metrics-history'](mockRequest, mockContext);
    assert.strictEqual(response.status, 200);
});

test('classes-api get-director-session-metrics-history filters by subjectId with pagination', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));
    const yesterdayIso = new Date(Date.now() - 86400000).toISOString();

    storageMocks.getTableClient.mock.mockImplementation(() => ({
        listEntities: makeListEntitiesResult([
            { userId: 'alu-001', promptTokens: 100, completionTokens: 50, totalTokens: 150, subjectId: 'arq-software-2026', classId: 'class-01', timestamp: yesterdayIso },
            { userId: 'alu-002', promptTokens: 200, completionTokens: 100, totalTokens: 300, subjectId: 'diseno-bd-2026', classId: 'class-02', timestamp: yesterdayIso },
        ])
    }));

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: {}, query: new Map([['subjectId', 'arq-software-2026']]) };

    const response = await handlers['get-director-session-metrics-history'](mockRequest, mockContext);
    assert.strictEqual(response.status, 200);

    const payload = JSON.parse(response.body);
    assert.strictEqual(payload.total, 1);
    assert.strictEqual(payload.history[0].subjectId, 'arq-software-2026');
});

test('classes-api get-director-session-metrics-history defaults limit to 1000 when limit is 0', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));
    const yesterdayIso = new Date(Date.now() - 86400000).toISOString();

    storageMocks.getTableClient.mock.mockImplementation(() => ({
        listEntities: makeListEntitiesResult([
            { userId: 'alu-001', promptTokens: 100, completionTokens: 50, totalTokens: 150, subjectId: 'arq-software-2026', classId: 'class-01', timestamp: yesterdayIso },
        ])
    }));

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: {}, query: new Map([['limit', '0']]) };

    const response = await handlers['get-director-session-metrics-history'](mockRequest, mockContext);
    assert.strictEqual(response.status, 200);

    const payload = JSON.parse(response.body);
    assert.strictEqual(payload.total, 1);
    assert.strictEqual(payload.hasMore, false);
});

test('classes-api get-director-session-metrics-history defaults limit to 1000 when limit param is empty', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));
    const yesterdayIso = new Date(Date.now() - 86400000).toISOString();

    storageMocks.getTableClient.mock.mockImplementation(() => ({
        listEntities: makeListEntitiesResult([
            { userId: 'alu-001', promptTokens: 100, completionTokens: 50, totalTokens: 150, subjectId: 'arq-software-2026', classId: 'class-01', timestamp: yesterdayIso },
        ])
    }));

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: {}, query: new Map([['limit', '']]) };

    const response = await handlers['get-director-session-metrics-history'](mockRequest, mockContext);
    assert.strictEqual(response.status, 200);

    const payload = JSON.parse(response.body);
    assert.strictEqual(payload.total, 1);
});

test('classes-api get-director-session-metrics-history rejects array continuationToken', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));

    storageMocks.getTableClient.mock.mockImplementation(() => ({
        listEntities: makeListEntitiesResult([])
    }));

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const arrayToken = Buffer.from(JSON.stringify([1, 2, 3])).toString('base64');
    const mockRequest = { params: {}, query: new Map([['continuationToken', arrayToken]]) };

    const response = await handlers['get-director-session-metrics-history'](mockRequest, mockContext);
    assert.strictEqual(response.status, 400);

    const payload = JSON.parse(response.body);
    assert.strictEqual(payload.error, 'Invalid continuation token');
});

test('classes-api get-director-session-metrics-history rejects string continuationToken', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));

    storageMocks.getTableClient.mock.mockImplementation(() => ({
        listEntities: makeListEntitiesResult([])
    }));

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const strToken = Buffer.from(JSON.stringify('raw-string')).toString('base64');
    const mockRequest = { params: {}, query: new Map([['continuationToken', strToken]]) };

    const response = await handlers['get-director-session-metrics-history'](mockRequest, mockContext);
    assert.strictEqual(response.status, 400);

    const payload = JSON.parse(response.body);
    assert.strictEqual(payload.error, 'Invalid continuation token');
});

test('classes-api get-director-session-metrics-history multi-page iteration with continuationToken', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));
    const yesterdayIso = new Date(Date.now() - 86400000).toISOString();

    const entities = [
        { userId: 'alu-001', promptTokens: 100, completionTokens: 50, totalTokens: 150, subjectId: 'arq-software-2026', classId: 'class-01', timestamp: yesterdayIso },
        { userId: 'alu-002', promptTokens: 200, completionTokens: 100, totalTokens: 300, subjectId: 'diseno-bd-2026', classId: 'class-02', timestamp: yesterdayIso },
    ];
    const page2Token = { _kind: 'page2' };
    const page1Returned = { called: false };

    let _listOpts = null;
    const iterable = {
        [Symbol.asyncIterator]: async function* () { for (const e of entities) yield e; },
        byPage: async function* (pageOptions) {
            if (pageOptions?.continuationToken) {
                const page = [entities[1]];
                page.continuationToken = null;
                yield page;
            } else {
                const page = [entities[0]];
                page.continuationToken = page2Token;
                yield page;
            }
        }
    };
    const listFn = (options) => { _listOpts = options; return iterable; };
    storageMocks.getTableClient.mock.mockImplementation(() => ({
        listEntities: listFn
    }));

    const mockContext = { log: makeMockLog(), error: mock.fn() };

    // First page
    const req1 = { params: {}, query: new Map([['limit', '1']]) };
    const res1 = await handlers['get-director-session-metrics-history'](req1, mockContext);
    assert.strictEqual(res1.status, 200);
    const body1 = JSON.parse(res1.body);
    assert.strictEqual(body1.total, 1);
    assert.strictEqual(body1.history[0].subjectId, 'arq-software-2026');
    assert.ok(body1.continuationToken !== null, 'first page should have continuationToken');
    assert.strictEqual(body1.hasMore, true);

    // Second page using token from first page
    const req2 = { params: {}, query: new Map([['limit', '1'], ['continuationToken', body1.continuationToken]]) };
    const res2 = await handlers['get-director-session-metrics-history'](req2, mockContext);
    assert.strictEqual(res2.status, 200);
    const body2 = JSON.parse(res2.body);
    assert.strictEqual(body2.total, 1);
    assert.strictEqual(body2.history[0].subjectId, 'diseno-bd-2026');
    assert.strictEqual(body2.continuationToken, null);
    assert.strictEqual(body2.hasMore, false);
});
