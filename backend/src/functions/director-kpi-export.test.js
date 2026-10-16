import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert';

// #340/#341 regression: director/kpi-export must never 500 for an authorized
// caller when data sources are empty or failing.

let principalMock = { userRoles: ['Director'], userId: 'director-1' };

const authMocks = {
    validateFrontDoorId: mock.fn(() => true),
    parseClientPrincipal: mock.fn(() => principalMock),
    setStashedIdentity: mock.fn(() => {}),
    trackNotificationInteraction: mock.fn(async () => {}),
};

const tableStores = new Map();

function makeTableClient(tableName) {
    return {
        async createTable() {
            if (!tableStores.has(tableName)) tableStores.set(tableName, new Map());
        },
        async getEntity(partitionKey, rowKey) {
            const store = tableStores.get(tableName) || new Map();
            const entity = store.get(`${partitionKey}/${rowKey}`);
            if (!entity) {
                const err = new Error('Entity not found');
                err.statusCode = 404;
                throw err;
            }
            return entity;
        },
        async upsertEntity(entity) {
            if (!tableStores.has(tableName)) tableStores.set(tableName, new Map());
            tableStores.get(tableName).set(`${entity.partitionKey}/${entity.rowKey}`, entity);
        },
        async *listEntities() {
            const store = tableStores.get(tableName) || new Map();
            yield* store.values();
        },
    };
}

const storageMocks = {
    getTableClient: mock.fn((tableName) => makeTableClient(tableName)),
};

const middlewareMocks = {
    withAuth: mock.fn((handler) => handler),
};

const correlationMocks = {
    withCorrelation: mock.fn((handler) => handler),
};

const EMPTY_METRICS = {
    latest: { dau: 0, ragInteractions: 0 },
    totals: { uniqueActiveUsers: 0, totalCost: 0 },
    daily: [],
    costBySubject: [],
    wausBySubject: [],
    materialUploads: { byTeacher: [] },
};

const classesApiMocks = {
    computeDirectorMetrics: mock.fn(async () => structuredClone(EMPTY_METRICS)),
    computeBudgetProjection: mock.fn(() => ({
        monthlyLimit: 0, currentSpend: 0, projectedEndOfMonth: 0, percentUsed: 0, warningLevel: 'none',
    })),
    computeCostSpikeAlert: mock.fn(() => null),
    loadEarlyAlertSummary: mock.fn(async () => ({
        totalStudentsAtRisk: 0, highRiskCount: 0, mediumRiskCount: 0,
        lowAttendanceCount: 0, lowGradeCount: 0,
        attendanceBelow60Count: 0, attendance60To75Count: 0, attendanceAbove75Count: 0,
    })),
    loadSubjects: mock.fn(async () => []),
    POWERBI_DEFAULT_DAYS: 14,
};

const azureCostMocks = {
    getAzureCostForBudget: mock.fn(async () => ({ success: false, currentMonthSpend: 0, daily: [] })),
    computeBudgetProjection: mock.fn(() => ({
        monthlyLimit: 0, currentSpend: 0, projectedEndOfMonth: 0, percentUsed: 0, warningLevel: 'none',
    })),
};

mock.module('../middleware/with-auth.js', { namedExports: middlewareMocks });
mock.module('../middleware/with-correlation.js', { namedExports: correlationMocks });
mock.module('../services/auth-utils.js', { namedExports: authMocks });
mock.module('../services/storage.js', { namedExports: storageMocks });
mock.module('./classes-api.js', { namedExports: classesApiMocks });
mock.module('../services/state-store.js', {
    namedExports: { countActiveStudentEnrollments: mock.fn(async () => 0) },
});
mock.module('../services/azure-cost.js', { namedExports: azureCostMocks });
mock.module('../services/telemetry.js', {
    namedExports: { trackNotificationInteraction: mock.fn(async () => {}) },
});
mock.module('../services/config.js', {
    namedExports: {
        CONFIG: {
            tables: {
                classes: 'Classes',
                interventions: 'Interventions',
                riskThresholds: 'RiskThresholds',
                userEvents: 'UserEvents',
            },
        },
    },
});

const handlers = {};
mock.module('@azure/functions', {
    namedExports: {
        app: {
            http: (name, options) => {
                handlers[name] = options.handler;
            },
        },
    },
});

await import('./director-kpi-export.js');

function makeContext() {
    return {
        log: Object.assign(mock.fn(() => {}), {
            warn: mock.fn(() => {}),
            error: mock.fn(() => {}),
        }),
        error: mock.fn(() => {}),
    };
}

function getRequest(format) {
    return {
        method: 'GET',
        query: new URLSearchParams(format ? `format=${format}` : ''),
        headers: new Map(),
    };
}

beforeEach(() => {
    tableStores.clear();
    principalMock = { userRoles: ['Director'], userId: 'director-1' };
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Development';
    classesApiMocks.computeDirectorMetrics.mock.mockImplementation(async () => structuredClone(EMPTY_METRICS));
    azureCostMocks.getAzureCostForBudget.mock.mockImplementation(
        async () => ({ success: false, currentMonthSpend: 0, daily: [] }),
    );
});

test('kpi-export returns 200 CSV with empty storage (no 500)', async () => {
    const res = await handlers['get-director-kpi-export'](getRequest('csv'), makeContext());
    assert.strictEqual(res.status, 200);
    assert.match(res.headers['Content-Type'], /text\/csv/);
    assert.match(res.body, /seccion,metrica,valor/);
});

test('kpi-export returns 200 printable HTML for format=pdf', async () => {
    const res = await handlers['get-director-kpi-export'](getRequest('pdf'), makeContext());
    assert.strictEqual(res.status, 200);
    assert.match(res.headers['Content-Type'], /text\/html/);
    assert.match(res.body, /Dashboard Directivo/);
});

test('kpi-export returns 200 CSV when metrics computation throws', async () => {
    classesApiMocks.computeDirectorMetrics.mock.mockImplementation(async () => {
        throw new Error('storage unavailable');
    });
    const res = await handlers['get-director-kpi-export'](getRequest('csv'), makeContext());
    assert.strictEqual(res.status, 200);
    assert.match(res.body, /seccion,metrica,valor/);
});

test('kpi-export returns 200 CSV when Azure Cost query throws', async () => {
    azureCostMocks.getAzureCostForBudget.mock.mockImplementation(async () => {
        throw new Error('cost api down');
    });
    const res = await handlers['get-director-kpi-export'](getRequest('csv'), makeContext());
    assert.strictEqual(res.status, 200);
});

test('kpi-export rejects unsupported format with 400', async () => {
    const res = await handlers['get-director-kpi-export'](getRequest('xml'), makeContext());
    assert.strictEqual(res.status, 400);
});

test('kpi-export returns 403 for non-director outside Development', async () => {
    delete process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    principalMock = { userRoles: ['Docente'], userId: 'teacher-1' };
    const res = await handlers['get-director-kpi-export'](getRequest('csv'), makeContext());
    assert.strictEqual(res.status, 403);
});

// #341: buildCsv/buildHtml threw on null entries, non-array dailyCost and
// string costs (string concat has no .toFixed) -> outer 500. The export must
// degrade to 200 for adversarial metric shapes in both formats.
test('kpi-export returns 200 CSV with null/malformed metric entries (no 500)', async () => {
    classesApiMocks.computeDirectorMetrics.mock.mockImplementation(async () => ({
        ...structuredClone(EMPTY_METRICS),
        costBySubject: [
            null,
            { subjectId: 's1', dailyCost: 'oops' },
            { subjectId: '__proto__', subjectName: { nested: true }, dailyCost: [{ cost: '0.5' }, null] },
        ],
        wausBySubject: [null, 'oops'],
        materialUploads: { byTeacher: [null, { teacherId: 't,1"x' }] },
    }));
    const res = await handlers['get-director-kpi-export'](getRequest('csv'), makeContext());
    assert.strictEqual(res.status, 200);
    assert.match(res.headers['Content-Type'], /text\/csv/);
    assert.match(res.body, /seccion,metrica,valor/);
});

test('kpi-export returns 200 printable HTML with null/malformed metric entries (no 500)', async () => {
    classesApiMocks.computeDirectorMetrics.mock.mockImplementation(async () => ({
        ...structuredClone(EMPTY_METRICS),
        costBySubject: [null, { subjectId: 's1', dailyCost: 42 }],
        wausBySubject: null,
        materialUploads: null,
        budget: undefined,
    }));
    const res = await handlers['get-director-kpi-export'](getRequest('pdf'), makeContext());
    assert.strictEqual(res.status, 200);
    assert.match(res.headers['Content-Type'], /text\/html/);
});

test('kpi-export quotes CSV cells with commas/quotes and coerces string costs', async () => {
    classesApiMocks.computeDirectorMetrics.mock.mockImplementation(async () => ({
        ...structuredClone(EMPTY_METRICS),
        costBySubject: [
            { subjectId: 'arq', subjectName: 'Arq, "Plan 2026"', dailyCost: [{ cost: '0.001' }] },
        ],
    }));
    const res = await handlers['get-director-kpi-export'](getRequest('csv'), makeContext());
    assert.strictEqual(res.status, 200);
    assert.match(res.body, /"Arq, ""Plan 2026""",0\.001000/);
});
