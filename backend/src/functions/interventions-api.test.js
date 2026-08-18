import { test, mock } from 'node:test';
import assert from 'node:assert';

let principalMock = { userRoles: ['Director'], userId: 'director-1' };

const authMocks = {
    validateFrontDoorId: mock.fn(() => true),
    parseClientPrincipal: mock.fn(() => principalMock),
    setStashedIdentity: mock.fn(() => {}),
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

mock.module('../middleware/with-auth.js', { namedExports: middlewareMocks });
mock.module('../middleware/with-correlation.js', { namedExports: correlationMocks });
mock.module('../services/auth-utils.js', { namedExports: authMocks });
mock.module('../services/storage.js', { namedExports: storageMocks });
mock.module('../services/config.js', {
    namedExports: {
        CONFIG: {
            tables: {
                interventions: 'Interventions',
                riskThresholds: 'RiskThresholds',
                userEvents: 'UserEvents',
            },
        },
    },
});

const handlers = {};
const routeOptions = {};
mock.module('@azure/functions', {
    namedExports: {
        app: {
            http: (name, options) => {
                handlers[name] = options.handler;
                routeOptions[name] = options;
            },
        },
    },
});

const { computeRisk, DEFAULT_THRESHOLDS } = await import('./interventions-api.js');

function daysAgo(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString();
}

function directorRequest(body) {
    return {
        json: async () => body,
    };
}

test('computeRisk uses DEFAULT_THRESHOLDS inactivity bands', () => {
    assert.strictEqual(computeRisk({ lastLogin: daysAgo(22), queryCount7d: 5, queryCount14d: 5 }).risk, 'high');
    assert.strictEqual(computeRisk({ lastLogin: daysAgo(15), queryCount7d: 5, queryCount14d: 5 }).risk, 'medium');
    assert.strictEqual(computeRisk({ lastLogin: daysAgo(8), queryCount7d: 5, queryCount14d: 5 }).risk, 'low');
    assert.strictEqual(computeRisk({ lastLogin: daysAgo(22), queryCount7d: 5, queryCount14d: 5 }).score, 8);
});

test('computeRisk respects custom inactivity thresholds', () => {
    const custom = { noLoginDaysLow: 1, noLoginDaysMedium: 5, noLoginDaysHigh: 10 };
    const result = computeRisk({ lastLogin: daysAgo(7), queryCount7d: 5, queryCount14d: 5 }, custom);
    assert.strictEqual(result.risk, 'medium');
    assert.strictEqual(result.score, 5);
});

test('computeRisk uses minQueries thresholds', () => {
    assert.strictEqual(computeRisk({ lastLogin: daysAgo(1), queryCount7d: 1, queryCount14d: 1 }).score, 4);
    assert.strictEqual(computeRisk({ lastLogin: daysAgo(1), queryCount7d: 3, queryCount14d: 4 }).score, 1);
    assert.strictEqual(computeRisk({ lastLogin: daysAgo(1), queryCount7d: 2, queryCount14d: 5 }).score, 0);
});

test('computeRisk flags attendance below attendanceWarning threshold', () => {
    const result = computeRisk({ lastLogin: daysAgo(1), queryCount7d: 5, queryCount14d: 5, attendance: 50 });
    assert.strictEqual(result.score, 3);
    assert.match(result.reason, /Asistencia/);
    assert.strictEqual(computeRisk({ lastLogin: daysAgo(1), queryCount7d: 5, queryCount14d: 5, attendance: 80 }).score, 0);
});

test('default attendance warning threshold is 60%', () => {
    assert.strictEqual(DEFAULT_THRESHOLDS.attendanceWarning, 60);
    assert.strictEqual(DEFAULT_THRESHOLDS.noLoginDaysLow, 7);
    assert.strictEqual(DEFAULT_THRESHOLDS.noLoginDaysMedium, 14);
    assert.strictEqual(DEFAULT_THRESHOLDS.noLoginDaysHigh, 21);
    assert.strictEqual(DEFAULT_THRESHOLDS.minQueriesMedium, 2);
});

test('risk-thresholds routes are registered (GET, PUT, POST)', () => {
    assert.ok(handlers['get-risk-thresholds']);
    assert.ok(handlers['update-risk-thresholds']);
    const methods = routeOptions['update-risk-thresholds'].methods;
    assert.ok(methods.includes('POST'));
    assert.ok(methods.includes('PUT'));
});

function updateThresholds(body) {
    return handlers['update-risk-thresholds'](directorRequest(body), { log: () => {} });
}

test('updateRiskThresholds persists merged config and returns 200', async () => {
    tableStores.clear();
    const response = await updateThresholds({
        subjectId: 'arq-software-2026',
        thresholds: { noLoginDaysLow: 3, noLoginDaysHigh: 9, attendanceWarning: 65 },
    });
    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.thresholds.noLoginDaysLow, 3);
    assert.strictEqual(body.data.thresholds.noLoginDaysHigh, 9);
    assert.strictEqual(body.data.thresholds.attendanceWarning, 65);
    assert.strictEqual(body.data.thresholds.minQueriesMedium, 2);
    const store = tableStores.get('RiskThresholds');
    const saved = store.get('arq-software-2026/config');
    assert.ok(saved);
    assert.strictEqual(JSON.parse(saved.config).noLoginDaysLow, 3);
});

test('updateRiskThresholds preserves previously stored keys on partial save', async () => {
    tableStores.clear();
    tableStores.set('RiskThresholds', new Map([
        ['arq-software-2026/config', {
            partitionKey: 'arq-software-2026',
            rowKey: 'config',
            config: JSON.stringify({ ...DEFAULT_THRESHOLDS, minQueriesHigh: 3 }),
            auditNotes: '[]',
        }],
    ]));

    const response = await updateThresholds({
        subjectId: 'arq-software-2026',
        thresholds: { noLoginDaysLow: 4 },
    });
    assert.strictEqual(response.status, 200);
    const saved = JSON.parse(tableStores.get('RiskThresholds').get('arq-software-2026/config').config);
    assert.strictEqual(saved.minQueriesHigh, 3);
    assert.strictEqual(saved.noLoginDaysLow, 4);
});

test('updateRiskThresholds rejects unknown threshold keys', async () => {
    const response = await updateThresholds({
        subjectId: 'arq-software-2026',
        thresholds: { unknownKey: 5 },
    });
    assert.strictEqual(response.status, 400);
    assert.match(JSON.parse(response.body).error, /Unknown threshold/);
});

test('updateRiskThresholds rejects invalid threshold values', async () => {
    tableStores.clear();
    const response = await updateThresholds({
        subjectId: 'arq-software-2026',
        thresholds: { noLoginDaysLow: -1 },
    });
    assert.strictEqual(response.status, 400);
    assert.match(JSON.parse(response.body).error, /Invalid threshold/);
});

test('updateRiskThresholds rejects attendance above 100', async () => {
    const response = await updateThresholds({
        subjectId: 'arq-software-2026',
        thresholds: { attendanceWarning: 150 },
    });
    assert.strictEqual(response.status, 400);
});

test('updateRiskThresholds rejects non-object thresholds', async () => {
    const response = await updateThresholds({
        subjectId: 'arq-software-2026',
        thresholds: [1, 2, 3],
    });
    assert.strictEqual(response.status, 400);
});

test('updateRiskThresholds rejects out-of-order inactivity days', async () => {
    const response = await updateThresholds({
        subjectId: 'arq-software-2026',
        thresholds: { noLoginDaysLow: 20, noLoginDaysMedium: 10, noLoginDaysHigh: 30 },
    });
    assert.strictEqual(response.status, 400);
    assert.match(JSON.parse(response.body).error, /ordering/);
});

test('updateRiskThresholds rejects missing fields', async () => {
    const response = await updateThresholds({ thresholds: { noLoginDaysLow: 3 } });
    assert.strictEqual(response.status, 400);
});

test('getRiskThresholds returns defaults when no config is saved', async () => {
    tableStores.clear();
    const response = await handlers['get-risk-thresholds'](
        { query: new URLSearchParams('subjectId=arq-software-2026') },
        { log: () => {} }
    );
    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.data.source, 'default');
    assert.strictEqual(body.data.thresholds.noLoginDaysLow, 7);
    assert.strictEqual(body.data.thresholds.attendanceWarning, 60);
});

function computeRequest(query) {
    return {
        query: new URLSearchParams(query),
    };
}

function seedUserEvents() {
    const store = tableStores.get('UserEvents');
    const ts = daysAgo(12);
    store.set('evt-1', { partitionKey: 'arq-software-2026', rowKey: 'evt-1', userId: 'stu-3', subjectId: 'arq-software-2026', eventType: 'login', timestamp: ts });
    store.set('evt-2', { partitionKey: 'arq-software-2026', rowKey: 'evt-2', userId: 'stu-3', subjectId: 'arq-software-2026', eventType: 'rag_query', timestamp: ts });
}

test('computeAndStoreInterventions uses saved thresholds', async () => {
    tableStores.clear();
    tableStores.set('RiskThresholds', new Map([
        ['arq-software-2026/config', {
            partitionKey: 'arq-software-2026',
            rowKey: 'config',
            config: JSON.stringify({ ...DEFAULT_THRESHOLDS, noLoginDaysHigh: 10 }),
        }],
    ]));
    tableStores.set('UserEvents', new Map());
    tableStores.set('Interventions', new Map());
    seedUserEvents();

    const response = await handlers['compute-interventions'](
        computeRequest('subjectId=arq-software-2026'),
        { log: () => {} }
    );
    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.ok(body.success);
    assert.strictEqual(body.data.computed, 1);
    assert.strictEqual(body.data.interventions[0].risk, 'high');
});

test('saving thresholds does not mutate existing interventions', async () => {
    tableStores.clear();
    tableStores.set('Interventions', new Map([
        ['arq-software-2026/stu-3_arq-software-2026', {
            partitionKey: 'arq-software-2026',
            rowKey: 'stu-3_arq-software-2026',
            studentId: 'stu-3',
            risk: 'medium',
            state: 'assigned',
            createdAt: '2026-08-01T00:00:00Z',
        }],
    ]));

    const response = await updateThresholds({
        subjectId: 'arq-software-2026',
        thresholds: { noLoginDaysHigh: 10 },
    });
    assert.strictEqual(response.status, 200);

    const interventions = tableStores.get('Interventions');
    assert.strictEqual(interventions.size, 1);
    const saved = interventions.get('arq-software-2026/stu-3_arq-software-2026');
    assert.strictEqual(saved.risk, 'medium');
    assert.strictEqual(saved.state, 'assigned');
});

test('getRiskThresholds returns merged override config with source override', async () => {
    tableStores.clear();
    tableStores.set('RiskThresholds', new Map([
        ['arq-software-2026/config', {
            partitionKey: 'arq-software-2026',
            rowKey: 'config',
            config: JSON.stringify({ ...DEFAULT_THRESHOLDS, noLoginDaysLow: 3 }),
        }],
    ]));

    const response = await handlers['get-risk-thresholds'](
        { query: new URLSearchParams('subjectId=arq-software-2026') },
        { log: () => {} }
    );
    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.data.source, 'override');
    assert.strictEqual(body.data.thresholds.noLoginDaysLow, 3);
    assert.strictEqual(body.data.thresholds.noLoginDaysHigh, 21);
});

test('computeAndStoreInterventions honors the default-partition config', async () => {
    tableStores.clear();
    tableStores.set('RiskThresholds', new Map([
        ['default/config', {
            partitionKey: 'default',
            rowKey: 'config',
            config: JSON.stringify({ ...DEFAULT_THRESHOLDS, noLoginDaysHigh: 10 }),
        }],
    ]));
    tableStores.set('UserEvents', new Map());
    tableStores.set('Interventions', new Map());
    seedUserEvents();

    const response = await handlers['compute-interventions'](
        computeRequest('subjectId=arq-software-2026'),
        { log: () => {} }
    );
    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.ok(body.success);
    assert.strictEqual(body.data.computed, 1);
    assert.strictEqual(body.data.interventions[0].risk, 'high');
});

test('computeAndStoreInterventions tolerates a corrupt config row', async () => {
    tableStores.clear();
    tableStores.set('RiskThresholds', new Map([
        ['default/config', { partitionKey: 'default', rowKey: 'config', config: 'not-json' }],
    ]));
    tableStores.set('UserEvents', new Map());
    tableStores.set('Interventions', new Map());
    seedUserEvents();

    const response = await handlers['compute-interventions'](
        computeRequest('subjectId=arq-software-2026'),
        { log: () => {} }
    );
    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.ok(body.success);
    assert.strictEqual(body.data.computed, 1);
});