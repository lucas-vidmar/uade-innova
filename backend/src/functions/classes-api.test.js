import { test, mock } from 'node:test';
import assert from 'node:assert';

// Define mocks before importing
const authUtilsMocks = {
    getAuthenticatedUser: mock.fn(() => ({ userId: 'prof-001' })),
    validateFrontDoorId: mock.fn(() => true),
    setStashedIdentity: mock.fn(() => {}),
    readDevIdentityHeader: mock.fn((request, name) => request?.headers?.get?.(name) || null),
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
    moveBlob: mock.fn(async () => true),
    listBlobs: mock.fn(async () => []),
    getTableClient: mock.fn(() => ({
        listEntities: defaultListEntities
    })),
    uploadFile: mock.fn(async () => true),
    downloadFile: mock.fn(async () => null),
};

const stateStoreMocks = {
    listClassesBySubject: mock.fn(async () => []),
    listMaterialsBySubject: mock.fn(async () => []),
    replaceClassesForSubject: mock.fn(async () => true),
    deleteMaterialStateById: mock.fn(async () => true),
    getMaterialState: mock.fn(async () => null),
    getMaterialStateById: mock.fn(async () => null),
    upsertMaterialState: mock.fn(async () => true),
    deleteClassesBySubject: mock.fn(async () => true),
    deleteMaterialsBySubject: mock.fn(async () => true),
    getEnrollmentsByUser: mock.fn(async () => []),
    getEnrollment: mock.fn(async () => null),
    listMaterialsByClass: mock.fn(async () => []),
    listClassViewsByStudent: mock.fn(async () => []),
    deleteClassViewsBySubject: mock.fn(async () => true),
    countActiveStudentEnrollments: mock.fn(async () => 0),
    // #491 (UJ-43): la lectura de adopción lee las filas de matrícula y las
    // dimensiones declaradas en el perfil.
    listAllEnrollments: mock.fn(async () => []),
    listProfileDimensions: mock.fn(async () => new Map()),
    // #428: la publicación de una clase pasa por estos dos servicios compartidos,
    // que ahora forman parte del grafo de importación de classes-api.js.
    getEnrollmentsBySubject: mock.fn(async () => []),
    upsertClassPublicationState: mock.fn(async () => ({})),
};

// Mock dependencies
mock.module('../services/auth-utils.js', { namedExports: authUtilsMocks });
mock.module('../services/storage.js', { namedExports: storageMocks });
mock.module('../services/state-store.js', {
    namedExports: stateStoreMocks
});
const notificationStoreMocks = {
    retractClassSummaryNotification: mock.fn(async () => ({ success: true, dispatched: 1, recipientCount: 0, retryAttempts: 0, deadLetterWrites: 0 })),
    dispatchClassSummaryNotification: mock.fn(async () => ({ success: true, dispatched: 1, recipientCount: 0, retryAttempts: 0, deadLetterWrites: 0 })),
};
mock.module('../services/notification-store.js', { namedExports: notificationStoreMocks });
mock.module('../services/upload-quota.js', {
    namedExports: {
        releaseUpload: mock.fn(async () => {}),
        checkUploadQuota: mock.fn(async () => ({ allowed: true })),
        recordUpload: mock.fn(async () => {}),
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

test('classes-api delete-material soft-deletes blobs to deleted/ container and reports chunkCount', async (t) => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Docente'] }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';

    stateStoreMocks.getMaterialStateById.mock.mockImplementation(async () => ({
        materialId: 'mat-soft',
        subjectId: 'arq-software-2026',
        filename: 'clase3.pdf',
        blobUrl: 'https://stacc.blob.core.windows.net/class-materials/arq-software-2026/mat-soft.pdf',
        chunkCount: 12,
        uploadedBy: 'doc-1',
        fileSize: 4096,
    }));

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: { materialId: 'mat-soft' } };

    const response = await handlers['delete-material'](mockRequest, mockContext);
    assert.strictEqual(response.status, 200);

    const body = JSON.parse(response.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.chunkCount, 12);
    assert.ok(Array.isArray(body.softDeleted), 'softDeleted should be a list of moved blob paths');
    assert.ok(body.softDeleted.some((name) => name.startsWith('deleted/')), 'blobs must be moved under deleted/');

    const moveCalls = storageMocks.moveBlob.mock.calls;
    assert.ok(
        moveCalls.some((call) => {
            const [src, name, dest] = call.arguments;
            return src === 'class-materials' && dest === 'deleted' && name === 'arq-software-2026/mat-soft.pdf';
        }),
        'original file blob should move from class-materials to deleted'
    );
    assert.ok(
        moveCalls.some((call) => {
            const [src, name, dest] = call.arguments;
            return src === 'processed' && dest === 'deleted' && name === 'mat-soft.json';
        }),
        'processed JSON should move from processed to deleted'
    );

    // Material state must be removed and quota released.
    assert.ok(stateStoreMocks.deleteMaterialStateById.mock.callCount() >= 1, 'material state should be deleted');

    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
});

test('classes-api delete-material falls back to pipeline blob pattern when blobUrl is missing', async (t) => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Docente'] }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';

    stateStoreMocks.getMaterialStateById.mock.mockImplementation(async () => ({
        materialId: 'mat-legacy',
        subjectId: 'arq-software-2026',
        filename: 'clase3.txt',
        chunkCount: 3,
    }));

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: { materialId: 'mat-legacy' } };

    const response = await handlers['delete-material'](mockRequest, mockContext);
    assert.strictEqual(response.status, 200);

    const body = JSON.parse(response.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.chunkCount, 3);

    const moveCalls = storageMocks.moveBlob.mock.calls;
    assert.ok(
        moveCalls.some((call) => {
            const [src, name, dest] = call.arguments;
            return src === 'class-materials' && dest === 'deleted' && name === 'arq-software-2026/mat-legacy.txt';
        }),
        'legacy blob name should derive from subjectId/materialId + extension'
    );

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

    // #419: el panel tiene que poder declarar el criterio del conteo.
    assert.match(payload.processedClassesCriteria, /síntesis o un mapa avalado por el docente/);
    assert.strictEqual(typeof payload.processedClasses, 'number');
    assert.strictEqual(typeof payload.processedClassesNotComputable, 'number');
});

test('classes-api get-director-stats counts procesadas from approved derivatives, not from the class total (#419)', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));

    storageMocks.getTableClient.mock.mockImplementation(() => ({
        listEntities: makeListEntitiesResult([
            { partitionKey: 'arq-software-2026', rowKey: 'class-01', summaryReady: false },
            { partitionKey: 'arq-software-2026', rowKey: 'class-02', summaryReady: false },
            { partitionKey: 'arq-software-2026', rowKey: 'class-03', summaryReady: false },
        ])
    }));
    storageMocks.listBlobs.mock.mockImplementation(async (container) => (container === 'class-summaries'
        ? ['arq-software-2026/class-01.json', 'arq-software-2026/class-02.json']
        : []));
    storageMocks.loadJson.mock.mockImplementation(async (container, name) => {
        if (name === 'arq-software-2026/class-01.json') return { classId: 'class-01', summary: 'Avalada', validated: true };
        return { classId: 'class-02', summary: 'Borrador del docente', validated: false };
    });

    try {
        const response = await handlers['get-director-stats']({ params: {}, query: new Map() }, { log: makeMockLog(), error: mock.fn() });
        assert.strictEqual(response.status, 200);

        const payload = JSON.parse(response.body);
        assert.strictEqual(payload.totalClasses, 3, 'las tres clases están cargadas');
        assert.strictEqual(payload.processedClasses, 1, 'sólo la clase con derivado avalado está procesada');
        assert.strictEqual(payload.processedClassesNotComputable, 0);
        assert.notStrictEqual(payload.processedClasses, payload.totalClasses);
    } finally {
        storageMocks.getTableClient.mock.mockImplementation(() => ({ listEntities: defaultListEntities }));
        storageMocks.listBlobs.mock.mockImplementation(async () => []);
        storageMocks.loadJson.mock.mockImplementation(async () => ({}));
    }
});

test('classes-api get-director-stats computes adoption against real active student enrollments (#417)', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));

    const now = new Date();
    const todayIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0)).toISOString();

    storageMocks.getTableClient.mock.mockImplementation(() => ({
        listEntities: makeListEntitiesResult([
            { userId: 'alu-001', subjectId: 'arq-software-2026', promptTokens: 100, completionTokens: 50, totalTokens: 150, timestamp: todayIso },
            { userId: 'alu-002', subjectId: 'arq-software-2026', promptTokens: 100, completionTokens: 50, totalTokens: 150, timestamp: todayIso },
        ])
    }));
    stateStoreMocks.countActiveStudentEnrollments.mock.mockImplementation(async () => 5);
    // #491: la cohorte son las matrículas reales de rol student; NO se inventa
    // una base de 60 por unidad (#417).
    stateStoreMocks.listAllEnrollments.mock.mockImplementation(async () => [
        { subjectId: 'arq-software-2026', userId: 'alu-001', role: 'student', status: 'active' },
        { subjectId: 'arq-software-2026', userId: 'alu-002', role: 'student', status: 'active' },
        { subjectId: 'arq-software-2026', userId: 'alu-003', role: 'student', status: 'active' },
        { subjectId: 'arq-software-2026', userId: 'alu-004', role: 'student', status: 'active' },
        { subjectId: 'arq-software-2026', userId: 'alu-005', role: 'student', status: 'active' },
        { subjectId: 'arq-software-2026', userId: 'prof-001', role: 'teacher', status: 'active' },
    ]);

    try {
        const response = await handlers['get-director-stats']({ params: {}, query: new Map() }, { log: makeMockLog(), error: mock.fn() });
        assert.strictEqual(response.status, 200);
        const payload = JSON.parse(response.body);
        // 2 personas activas de la cohorte sobre una base real de 5 matrículas.
        assert.strictEqual(payload.adoptionRate, 40);
        assert.strictEqual(payload.adoptionCohort, 5);
        assert.strictEqual(payload.adoptionByDimension.subject.total.cohort, 5);
        assert.strictEqual(payload.adoptionByDimension.subject.total.active, 2);
        // El docente matriculado no entra en la cohorte de adopción.
        assert.strictEqual(payload.adoptionByDimension.campus.total.cohort, 5);
        assert.strictEqual(payload.adoptionIntegrity.enrollmentsSkipped, 1);
        assert.strictEqual(payload.adoptionIntegrity.orphanPeople, 0);
    } finally {
        storageMocks.getTableClient.mock.mockImplementation(() => ({ listEntities: defaultListEntities }));
        stateStoreMocks.countActiveStudentEnrollments.mock.mockImplementation(async () => 0);
        stateStoreMocks.listAllEnrollments.mock.mockImplementation(async () => []);
    }
});

test('classes-api get-director-stats does not invent an adoption rate without enrollment rows (#417/#491)', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));

    stateStoreMocks.countActiveStudentEnrollments.mock.mockImplementation(async () => 0);
    stateStoreMocks.listAllEnrollments.mock.mockImplementation(async () => []);

    const response = await handlers['get-director-stats']({ params: {}, query: new Map() }, { log: makeMockLog(), error: mock.fn() });
    assert.strictEqual(response.status, 200);
    const payload = JSON.parse(response.body);
    // Sin cohorte no hay tasa: se declara no calculable en vez de informar 0%,
    // que se leería como «nadie usó el servicio».
    assert.strictEqual(payload.adoptionRate, null);
    assert.strictEqual(payload.adoptionCohort, 0);
    assert.strictEqual(payload.adoptionByDimension.campus.total.rate, null);
});

test('classes-api get-director-stats expone la lectura por sede y carrera con los huecos declarados (#491)', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));

    const now = new Date();
    const todayIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0)).toISOString();
    storageMocks.getTableClient.mock.mockImplementation(() => ({
        listEntities: makeListEntitiesResult([
            { userId: 'alu-001', subjectId: 'arq-software-2026', promptTokens: 10, completionTokens: 5, totalTokens: 15, timestamp: todayIso },
        ])
    }));
    stateStoreMocks.listAllEnrollments.mock.mockImplementation(async () => [
        { subjectId: 'arq-software-2026', userId: 'alu-001', role: 'student', status: 'active', campus: 'Monserrat' },
        { subjectId: 'arq-software-2026', userId: 'alu-002', role: 'student', status: 'active', campus: 'Recoleta' },
        { subjectId: 'arq-software-2026', userId: 'alu-003', role: 'student', status: 'active' },
    ]);
    stateStoreMocks.listProfileDimensions.mock.mockImplementation(async () => new Map([['alu-003', { campus: 'Monserrat', track: 'Tecnicatura' }]]));

    try {
        const response = await handlers['get-director-stats']({ params: {}, query: new Map() }, { log: makeMockLog(), error: mock.fn() });
        const payload = JSON.parse(response.body);
        const campusRows = payload.adoptionByDimension.campus.rows;
        assert.deepEqual(campusRows.map((row) => row.label).sort(), ['Monserrat', 'Recoleta']);
        assert.strictEqual(payload.adoptionByDimension.campus.total.cohort, 3);
        assert.strictEqual(payload.adoptionByDimension.campus.total.active, 1);
        assert.strictEqual(payload.adoptionByDimension.campus.total.rate, 33);
        assert.strictEqual(payload.adoptionByDimension.track.total.cohort, 3);
        assert.strictEqual(payload.adoptionByDimension.track.total.rows, 2, 'Tecnicatura (unidad + perfil) y sin carrera declarada');
        assert.ok(payload.adoptionGaps.some((gap) => gap.reason === 'carrera_sin_declarar'));
        assert.ok(payload.adoptionCriteria.includes('SessionMetrics'));
        assert.strictEqual(payload.adoptionSources.dimensions.readable, true);
    } finally {
        storageMocks.getTableClient.mock.mockImplementation(() => ({ listEntities: defaultListEntities }));
        stateStoreMocks.listAllEnrollments.mock.mockImplementation(async () => []);
        stateStoreMocks.listProfileDimensions.mock.mockImplementation(async () => new Map());
    }
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
    assert.strictEqual(body.error, 'Forbidden - Director or Admin access required');

    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
});

test('classes-api get-director-stats allows Admin role (Panel Técnico)', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['authenticated', 'Admin'] }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';

    storageMocks.getTableClient.mock.mockImplementation(() => ({
        listEntities: makeListEntitiesResult([])
    }));

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: {}, query: new Map() };

    const response = await handlers['get-director-stats'](mockRequest, mockContext);
    assert.strictEqual(response.status, 200);

    const payload = JSON.parse(response.body);
    assert.ok(payload.budget, 'budget object should exist for Admin');
    assert.strictEqual(payload.budget.monthlyLimit, Number(process.env.DIRECTOR_BUDGET_MONTHLY_USD) || 10000);

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

test('#328: get-class-summary requires subjectId (400 without it)', async (t) => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Docente'] }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: { classId: 'class-01' }, query: new URLSearchParams() };

    const response = await handlers['get-class-summary'](mockRequest, mockContext);
    assert.strictEqual(response.status, 400);

    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
});

test('#328: get-class-summary serves the scoped blob for (subjectId, classId)', async (t) => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Docente'] }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';

    const restoreLoadJson = async () => ({});
    storageMocks.loadJson.mock.mockImplementation(async (container, blobName) => {
        if (container === 'class-summaries' && blobName === 'arq-software-2026/class-01.json') {
            return { classId: 'class-01', subjectId: 'arq-software-2026', summary: 'scoped' };
        }
        return null;
    });

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: { classId: 'class-01' }, query: new URLSearchParams({ subjectId: 'arq-software-2026' }) };

    try {
        const response = await handlers['get-class-summary'](mockRequest, mockContext);
        assert.strictEqual(response.status, 200);
        const body = JSON.parse(response.body);
        assert.strictEqual(body.summary, 'scoped');
    } finally {
        storageMocks.loadJson.mock.mockImplementation(restoreLoadJson);
        process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
    }
});

test('#328: get-class-summary never serves a legacy blob of another subject', async (t) => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Docente'] }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';

    const restoreLoadJson = async () => ({});
    storageMocks.loadJson.mock.mockImplementation(async (container, blobName) => {
        if (container === 'class-summaries' && blobName === 'class-01.json') {
            return { classId: 'class-01', subjectId: 'dasi-1c2023', summary: 'DASI leak' };
        }
        return null;
    });

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: { classId: 'class-01' }, query: new URLSearchParams({ subjectId: 'arq-software-2026' }) };

    try {
        const response = await handlers['get-class-summary'](mockRequest, mockContext);
        assert.strictEqual(response.status, 200);
        const body = JSON.parse(response.body);
        assert.strictEqual(body.summary, null, 'cross-subject legacy blob must not leak');
    } finally {
        storageMocks.loadJson.mock.mockImplementation(restoreLoadJson);
        process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
    }
});

test('#328: save-class-summary writes to the scoped path and requires subjectId', async (t) => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Docente'] }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';

    const mockContext = { log: makeMockLog(), error: mock.fn() };

    const noSubject = await handlers['save-class-summary'](
        { params: { classId: 'class-01' }, json: async () => ({ summary: 'x' }) },
        mockContext
    );
    assert.strictEqual(noSubject.status, 400);

    storageMocks.saveJson.mock.resetCalls();
    const ok = await handlers['save-class-summary'](
        { params: { classId: 'class-01' }, json: async () => ({ subjectId: 'arq-software-2026', summary: 'x', validated: true }) },
        mockContext
    );
    assert.strictEqual(ok.status, 200);
    const saveCalls = storageMocks.saveJson.mock.calls;
    assert.ok(
        saveCalls.some((call) => call.arguments[0] === 'class-summaries' && call.arguments[1] === 'arq-software-2026/class-01.json'),
        'must write to the scoped blob path'
    );

    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
});

// #428: un solo estado de publicación explícito (`borrador` | `pendiente_de_aval`
// | `publicado`) para la clase y sus derivados. Guardar el contenido ya no mueve
// la visibilidad: sólo la mueve la acción explícita, que deja constancia de quién
// y cuándo. Antes el estado vivía en dos lugares (`summaryReady` y `validated`) y
// podían contradecirse.
test('#428: save-class-summary sin estado explícito conserva el estado de publicación de la clase', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Docente'], userDetails: 'prof01@uade.edu.ar' }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';
    const restoreLoadJson = storageMocks.loadJson.mock.mockImplementation;
    storageMocks.saveJson.mock.resetCalls();
    storageMocks.loadJson.mock.mockImplementation(async (container, blob) => {
        if (container === 'classes-config' && blob === 'arq-software-2026.json') {
            return [{ id: 'class-01', title: 'Clase 1', summaryReady: true }];
        }
        if (container === 'class-summaries') return { classId: 'class-01', summary: 'previo', validated: true };
        return {};
    });

    try {
        const res = await handlers['save-class-summary'](
            { params: { classId: 'class-01' }, json: async () => ({ subjectId: 'arq-software-2026', summary: 'borrador', validated: false }) },
            { log: makeMockLog(), error: mock.fn() }
        );
        assert.strictEqual(res.status, 200);
        const body = JSON.parse(res.body);
        assert.strictEqual(body.publicationState, 'publicado', 'la clase sigue publicada: guardar contenido no la retira');
        assert.strictEqual(body.validated, true, '`validated` es espejo del estado, no un dato propio');

        const classWrite = storageMocks.saveJson.mock.calls.find(
            (call) => call.arguments[0] === 'classes-config' && call.arguments[1] === 'arq-software-2026.json'
        );
        assert.strictEqual(classWrite, undefined, 'no debe tocar el estado de publicación de la clase');

        const summaryWrite = storageMocks.saveJson.mock.calls.find(
            (call) => call.arguments[0] === 'class-summaries' && call.arguments[1] === 'arq-software-2026/class-01.json'
        );
        assert.strictEqual(summaryWrite.arguments[2].publicationState, 'publicado');
    } finally {
        storageMocks.loadJson.mock.mockImplementation(restoreLoadJson);
        process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
    }
});

test('#428: save-class-summary con `pendiente_de_aval` no publica y no avisa al alumnado', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Docente'], userDetails: 'prof01@uade.edu.ar' }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';
    const restoreLoadJson = storageMocks.loadJson.mock.mockImplementation;
    storageMocks.saveJson.mock.resetCalls();
    storageMocks.loadJson.mock.mockImplementation(async (container, blob) => {
        if (container === 'classes-config' && blob === 'arq-software-2026.json') {
            return [{ id: 'class-01', title: 'Clase 1', summaryReady: false }];
        }
        if (container === 'class-summaries') return { classId: 'class-01', summary: 'previo', validated: false };
        return {};
    });

    try {
        const res = await handlers['save-class-summary'](
            { params: { classId: 'class-01' }, json: async () => ({ subjectId: 'arq-software-2026', summary: 'listo para revisar', publicationState: 'pendiente_de_aval' }) },
            { log: makeMockLog(), error: mock.fn() }
        );
        assert.strictEqual(res.status, 200);
        const body = JSON.parse(res.body);
        assert.strictEqual(body.publicationState, 'pendiente_de_aval', 'la clase queda esperando el aval');
        assert.strictEqual(body.summaryReady, false, 'sin aval el alumnado no la ve');

        const classWrite = storageMocks.saveJson.mock.calls.find(
            (call) => call.arguments[0] === 'classes-config' && call.arguments[1] === 'arq-software-2026.json'
        );
        assert.ok(classWrite, 'debe registrar el estado en la clase');
        assert.strictEqual(classWrite.arguments[2][0].publicationState, 'pendiente_de_aval');
        assert.strictEqual(classWrite.arguments[2][0].summaryReady, false);

        const notificationWrite = storageMocks.saveJson.mock.calls.find((call) => call.arguments[0] === 'notifications');
        assert.strictEqual(notificationWrite, undefined, 'no se emite el aviso de resumen validado');
    } finally {
        storageMocks.loadJson.mock.mockImplementation(restoreLoadJson);
        process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
    }
});

test('#428: pasar a borrador retira la clase, deja constancia de quién y cuándo, y avisa a la cohorte', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Docente'], userDetails: 'prof01@uade.edu.ar' }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';
    const restoreLoadJson = storageMocks.loadJson.mock.mockImplementation;
    storageMocks.saveJson.mock.resetCalls();
    notificationStoreMocks.retractClassSummaryNotification.mock.resetCalls();
    storageMocks.loadJson.mock.mockImplementation(async (container, blob) => {
        if (container === 'classes-config' && blob === 'arq-software-2026.json') {
            return [{ id: 'class-01', title: 'Clase 1', summaryReady: true, publicationState: 'publicado' }];
        }
        if (container === 'class-summaries' && blob === 'arq-software-2026/class-01.json') {
            return { classId: 'class-01', subjectId: 'arq-software-2026', summary: '# Resumen', validated: true, publicationState: 'publicado' };
        }
        if (container === 'notifications') {
            return [{ id: 'notif-auto-summary-arq-software-2026-class-01', type: 'summary', title: 'Resumen validado por docente', message: 'Clase 1 ya tiene resumen validado.', createdAt: '2026-10-10T10:00:00Z', subjectId: 'arq-software-2026' }];
        }
        return null;
    });

    try {
        const res = await handlers['set-class-publication-state'](
            { params: { classId: 'class-01' }, json: async () => ({ subjectId: 'arq-software-2026', state: 'borrador', reason: 'reemplazada por la guía nueva' }) },
            { log: makeMockLog(), error: mock.fn() }
        );
        assert.strictEqual(res.status, 200);
        const body = JSON.parse(res.body);
        assert.strictEqual(body.changed, true);
        assert.strictEqual(body.previousState, 'publicado');
        assert.strictEqual(body.publicationState, 'borrador');
        assert.strictEqual(body.summaryReady, false);
        assert.strictEqual(body.changedBy, 'prof01@uade.edu.ar', 'queda registrado quién retiró');
        assert.ok(body.changedAt, 'queda registrado cuándo');

        const summaryWrite = storageMocks.saveJson.mock.calls.find(
            (call) => call.arguments[0] === 'class-summaries' && call.arguments[1] === 'arq-software-2026/class-01.json'
        );
        const summaryAsset = summaryWrite.arguments[2];
        assert.strictEqual(summaryAsset.publicationState, 'borrador');
        assert.strictEqual(summaryAsset.validated, false, 'el espejo deja de afirmar que está validado');
        assert.strictEqual(summaryAsset.publicationChangedReason, 'reemplazada por la guía nueva');
        assert.strictEqual(summaryAsset.publicationHistory.at(-1).by, 'prof01@uade.edu.ar');
        assert.strictEqual(summaryAsset.publicationHistory.at(-1).reason, 'reemplazada por la guía nueva');

        const classWrite = storageMocks.saveJson.mock.calls.find(
            (call) => call.arguments[0] === 'classes-config' && call.arguments[1] === 'arq-software-2026.json'
        );
        assert.strictEqual(classWrite.arguments[2][0].publicationState, 'borrador');
        assert.strictEqual(classWrite.arguments[2][0].summaryReady, false);

        const retirement = notificationStoreMocks.retractClassSummaryNotification.mock.calls.at(-1)?.arguments[0];
        assert.ok(retirement, 'el retiro debe reemplazar el aviso de publicación por uno de retiro');
        assert.strictEqual(retirement.subjectId, 'arq-software-2026');
        assert.strictEqual(retirement.classData.id, 'class-01');
        assert.strictEqual(retirement.classData.publicationState, 'borrador');
    } finally {
        storageMocks.loadJson.mock.mockImplementation(restoreLoadJson);
        process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
    }
});


test('#428: no se puede publicar una clase sin resumen ni pasar un estado inventado', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Docente'], userDetails: 'prof01@uade.edu.ar' }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';
    const restoreLoadJson = storageMocks.loadJson.mock.mockImplementation;
    storageMocks.loadJson.mock.mockImplementation(async (container, blob) => {
        if (container === 'classes-config' && blob === 'arq-software-2026.json') {
            return [{ id: 'class-01', title: 'Clase 1', summaryReady: false }];
        }
        return null;
    });

    try {
        const noContent = await handlers['set-class-publication-state'](
            { params: { classId: 'class-01' }, json: async () => ({ subjectId: 'arq-software-2026', state: 'publicado' }) },
            { log: makeMockLog(), error: mock.fn() }
        );
        assert.strictEqual(noContent.status, 409);

        const badState = await handlers['set-class-publication-state'](
            { params: { classId: 'class-01' }, json: async () => ({ subjectId: 'arq-software-2026', state: 'en-produccion' }) },
            { log: makeMockLog(), error: mock.fn() }
        );
        assert.strictEqual(badState.status, 400);
    } finally {
        storageMocks.loadJson.mock.mockImplementation(restoreLoadJson);
        process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
    }
});

test('#428: el alumnado no recibe el resumen de una clase sin publicar (el docente sí)', async () => {
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';
    const restoreLoadJson = storageMocks.loadJson.mock.mockImplementation;
    storageMocks.loadJson.mock.mockImplementation(async (container, blob) => {
        if (container === 'class-summaries' && blob === 'arq-software-2026/class-01.json') {
            return { classId: 'class-01', subjectId: 'arq-software-2026', summary: '# Borrador', publicationState: 'borrador', validated: false };
        }
        return null;
    });
    const request = {
        params: { classId: 'class-01' },
        query: { get: (key) => (key === 'subjectId' ? 'arq-software-2026' : null) },
    };
    const restoreEnrollment = stateStoreMocks.getEnrollment.mock.mockImplementation;
    stateStoreMocks.getEnrollment.mock.mockImplementation(async () => ({ status: 'active', role: 'student' }));

    try {
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Estudiante'], userId: 'alu-001' }));
        const asStudent = await handlers['get-class-summary'](request, { log: makeMockLog(), error: mock.fn() });
        const studentBody = JSON.parse(asStudent.body);
        assert.strictEqual(asStudent.status, 200);
        assert.strictEqual(studentBody.summary, null, 'el borrador no llega al alumnado');
        assert.strictEqual(studentBody.publicationState, 'borrador');

        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Docente'], userDetails: 'prof01@uade.edu.ar' }));
        const asTeacher = await handlers['get-class-summary'](request, { log: makeMockLog(), error: mock.fn() });
        const teacherBody = JSON.parse(asTeacher.body);
        assert.strictEqual(teacherBody.summary, '# Borrador', 'el docente revisa el borrador');
        assert.strictEqual(teacherBody.publicationState, 'borrador');
    } finally {
        storageMocks.loadJson.mock.mockImplementation(restoreLoadJson);
        stateStoreMocks.getEnrollment.mock.mockImplementation(restoreEnrollment);
        process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: [] }));
    }
});

// #498: un derivado comparte el estado de su clase. Las filas anteriores a #428
// pueden tener el derivado sin `publicationState` explícito mientras la clase ya
// está publicada; antes el derivado caía a `borrador` y el alumnado abría una
// clase publicada sin su resumen.
test('#498: un derivado sin estado explícito hereda el de la clase publicada (el alumnado recibe el resumen)', async () => {
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';
    const restoreLoadJson = storageMocks.loadJson.mock.mockImplementation;
    const restoreEnrollment = stateStoreMocks.getEnrollment.mock.mockImplementation;
    storageMocks.loadJson.mock.mockImplementation(async (container, blob) => {
        if (container === 'class-summaries' && blob === 'arq-software-2026/class-01.json') {
            // Fila legada: sin `publicationState` ni `validated`.
            return { classId: 'class-01', subjectId: 'arq-software-2026', summary: '# Resumen legado' };
        }
        if (container === 'classes-config' && blob === 'arq-software-2026.json') {
            return [{ id: 'class-01', title: 'Clase 1', publicationState: 'publicado', summaryReady: true }];
        }
        return null;
    });
    stateStoreMocks.getEnrollment.mock.mockImplementation(async () => ({ status: 'active', role: 'student' }));
    const request = {
        params: { classId: 'class-01' },
        query: { get: (key) => (key === 'subjectId' ? 'arq-software-2026' : null) },
    };

    try {
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Estudiante'], userId: 'alu-005' }));
        const asStudent = await handlers['get-class-summary'](request, { log: makeMockLog(), error: mock.fn() });
        const studentBody = JSON.parse(asStudent.body);
        assert.strictEqual(asStudent.status, 200);
        assert.strictEqual(studentBody.publicationState, 'publicado', 'el derivado hereda el estado de la clase');
        assert.strictEqual(studentBody.summary, '# Resumen legado', 'el alumnado recibe el resumen de una clase publicada');
    } finally {
        storageMocks.loadJson.mock.mockImplementation(restoreLoadJson);
        stateStoreMocks.getEnrollment.mock.mockImplementation(restoreEnrollment);
        process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: [] }));
    }
});

test('#498: un derivado con estado explícito en borrador se respeta aunque la clase esté publicada', async () => {
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';
    const restoreLoadJson = storageMocks.loadJson.mock.mockImplementation;
    const restoreEnrollment = stateStoreMocks.getEnrollment.mock.mockImplementation;
    storageMocks.loadJson.mock.mockImplementation(async (container, blob) => {
        if (container === 'class-summaries' && blob === 'arq-software-2026/class-01.json') {
            // Estado explícito (por ejemplo, un resumen regenerado): no se toca.
            return { classId: 'class-01', subjectId: 'arq-software-2026', summary: '# Regenerado', publicationState: 'borrador', validated: false };
        }
        if (container === 'classes-config' && blob === 'arq-software-2026.json') {
            return [{ id: 'class-01', title: 'Clase 1', publicationState: 'publicado', summaryReady: true }];
        }
        return null;
    });
    stateStoreMocks.getEnrollment.mock.mockImplementation(async () => ({ status: 'active', role: 'student' }));
    const request = {
        params: { classId: 'class-01' },
        query: { get: (key) => (key === 'subjectId' ? 'arq-software-2026' : null) },
    };

    try {
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Estudiante'], userId: 'alu-005' }));
        const asStudent = await handlers['get-class-summary'](request, { log: makeMockLog(), error: mock.fn() });
        const studentBody = JSON.parse(asStudent.body);
        assert.strictEqual(asStudent.status, 200);
        assert.strictEqual(studentBody.publicationState, 'borrador', 'el estado explícito del derivado manda');
        assert.strictEqual(studentBody.summary, null, 'el borrador explícito sigue oculto para el alumnado');
    } finally {
        storageMocks.loadJson.mock.mockImplementation(restoreLoadJson);
        stateStoreMocks.getEnrollment.mock.mockImplementation(restoreEnrollment);
        process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: [] }));
    }
});

// #498 (residual): una fila de derivado VACÍA (placeholder legado: contenido en
// null, sin generación ni autor) no es un borrador deliberado — no hay contenido
// que proteger — y su `publicationState: "borrador"` dejaba a la clase publicada
// contradicha para siempre (el docente veía «✅ Publicado» y «resumen 📝 Borrador»
// en la misma pantalla). El estado de la clase manda.
test('#498 residual: un derivado vacío no contradice a su clase publicada (resumen)', async () => {
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';
    const restoreLoadJson = storageMocks.loadJson.mock.mockImplementation;
    const restoreEnrollment = stateStoreMocks.getEnrollment.mock.mockImplementation;
    storageMocks.loadJson.mock.mockImplementation(async (container, blob) => {
        if (container === 'class-summaries' && blob === 'arq-software-2026/class-02.json') {
            // Placeholder legado: sin contenido y con estado explícito en borrador.
            return { classId: 'class-02', subjectId: 'arq-software-2026', summary: null, publicationState: 'borrador' };
        }
        if (container === 'classes-config' && blob === 'arq-software-2026.json') {
            return [{ id: 'class-02', title: 'Clase 2', publicationState: 'publicado', summaryReady: true }];
        }
        return null;
    });
    stateStoreMocks.getEnrollment.mock.mockImplementation(async () => ({ status: 'active', role: 'student' }));
    const request = {
        params: { classId: 'class-02' },
        query: { get: (key) => (key === 'subjectId' ? 'arq-software-2026' : null) },
    };

    try {
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Estudiante'], userId: 'alu-005' }));
        const asStudent = await handlers['get-class-summary'](request, { log: makeMockLog(), error: mock.fn() });
        const studentBody = JSON.parse(asStudent.body);
        assert.strictEqual(asStudent.status, 200);
        assert.strictEqual(studentBody.publicationState, 'publicado', 'el derivado vacío hereda el estado de su clase');
        assert.notStrictEqual(studentBody.hidden, true, 'una clase publicada no oculta a su derivado vacío');
        assert.strictEqual(studentBody.summary, null, 'no se inventa contenido: sigue sin haber resumen');
    } finally {
        storageMocks.loadJson.mock.mockImplementation(restoreLoadJson);
        stateStoreMocks.getEnrollment.mock.mockImplementation(restoreEnrollment);
        process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: [] }));
    }
});

test('#498 residual: un derivado vacío no contradice a su clase publicada (mapa)', async () => {
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';
    const restoreLoadJson = storageMocks.loadJson.mock.mockImplementation;
    const restoreEnrollment = stateStoreMocks.getEnrollment.mock.mockImplementation;
    storageMocks.loadJson.mock.mockImplementation(async (container, blob) => {
        if (container === 'class-maps' && blob === 'arq-software-2026/class-02.json') {
            return { classId: 'class-02', subjectId: 'arq-software-2026', mapCode: null, publicationState: 'borrador' };
        }
        if (container === 'classes-config' && blob === 'arq-software-2026.json') {
            return [{ id: 'class-02', title: 'Clase 2', publicationState: 'publicado', summaryReady: true }];
        }
        return null;
    });
    stateStoreMocks.getEnrollment.mock.mockImplementation(async () => ({ status: 'active', role: 'student' }));
    const request = {
        params: { classId: 'class-02' },
        query: { get: (key) => (key === 'subjectId' ? 'arq-software-2026' : null) },
    };

    try {
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Estudiante'], userId: 'alu-005' }));
        const asStudent = await handlers['get-class-map'](request, { log: makeMockLog(), error: mock.fn() });
        const studentBody = JSON.parse(asStudent.body);
        assert.strictEqual(asStudent.status, 200);
        assert.strictEqual(studentBody.publicationState, 'publicado', 'el mapa vacío hereda el estado de su clase');
        assert.notStrictEqual(studentBody.hidden, true, 'una clase publicada no oculta su mapa vacío');
    } finally {
        storageMocks.loadJson.mock.mockImplementation(restoreLoadJson);
        stateStoreMocks.getEnrollment.mock.mockImplementation(restoreEnrollment);
        process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: [] }));
    }
});

test('#498 residual: un derivado CON contenido y estado explícito en borrador sigue respetándose', async () => {
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';
    const restoreLoadJson = storageMocks.loadJson.mock.mockImplementation;
    const restoreEnrollment = stateStoreMocks.getEnrollment.mock.mockImplementation;
    storageMocks.loadJson.mock.mockImplementation(async (container, blob) => {
        if (container === 'class-summaries' && blob === 'arq-software-2026/class-02.json') {
            return { classId: 'class-02', subjectId: 'arq-software-2026', summary: '# Borrador en curso', publicationState: 'borrador', validated: false };
        }
        if (container === 'classes-config' && blob === 'arq-software-2026.json') {
            return [{ id: 'class-02', title: 'Clase 2', publicationState: 'publicado', summaryReady: true }];
        }
        return null;
    });
    stateStoreMocks.getEnrollment.mock.mockImplementation(async () => ({ status: 'active', role: 'student' }));
    const request = {
        params: { classId: 'class-02' },
        query: { get: (key) => (key === 'subjectId' ? 'arq-software-2026' : null) },
    };

    try {
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Estudiante'], userId: 'alu-005' }));
        const asStudent = await handlers['get-class-summary'](request, { log: makeMockLog(), error: mock.fn() });
        const studentBody = JSON.parse(asStudent.body);
        assert.strictEqual(asStudent.status, 200);
        assert.strictEqual(studentBody.publicationState, 'borrador', 'el borrador explícito con contenido manda');
        assert.strictEqual(studentBody.summary, null, 'el borrador explícito con contenido sigue oculto para el alumnado');
    } finally {
        storageMocks.loadJson.mock.mockImplementation(restoreLoadJson);
        stateStoreMocks.getEnrollment.mock.mockImplementation(restoreEnrollment);
        process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: [] }));
    }
});

// #507 (residual): un derivado AUSENTE (la clase nunca generó el activo) tampoco
// puede contradecir a su clase. El endpoint devolvía `publicationState: 'borrador'`
// fijo cuando no encontraba el activo, sin mirar la clase, así que una clase
// `publicado` sin resumen generado mostraba «✅ Publicado» junto a «resumen 📝
// Borrador». Sin activo propio manda el estado de la clase; el contenido sigue null.
test('#507 residual: un derivado ausente no contradice a su clase publicada (resumen)', async () => {
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';
    const restoreLoadJson = storageMocks.loadJson.mock.mockImplementation;
    const restoreEnrollment = stateStoreMocks.getEnrollment.mock.mockImplementation;
    storageMocks.loadJson.mock.mockImplementation(async (container, blob) => {
        // No hay activo de resumen para class-02: la clase existe y está publicada.
        if (container === 'classes-config' && blob === 'arq-software-2026.json') {
            return [{ id: 'class-02', title: 'Clase 2', publicationState: 'publicado', summaryReady: true }];
        }
        return null;
    });
    stateStoreMocks.getEnrollment.mock.mockImplementation(async () => ({ status: 'active', role: 'student' }));
    const request = {
        params: { classId: 'class-02' },
        query: { get: (key) => (key === 'subjectId' ? 'arq-software-2026' : null) },
    };

    try {
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Estudiante'], userId: 'alu-005' }));
        const asStudent = await handlers['get-class-summary'](request, { log: makeMockLog(), error: mock.fn() });
        const studentBody = JSON.parse(asStudent.body);
        assert.strictEqual(asStudent.status, 200);
        assert.strictEqual(studentBody.publicationState, 'publicado', 'sin activo propio manda el estado de la clase');
        assert.notStrictEqual(studentBody.hidden, true, 'una clase publicada no oculta su derivado ausente');
        assert.strictEqual(studentBody.summary, null, 'no se inventa contenido: sigue sin haber resumen');

        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Docente'], userId: 'prof-001' }));
        const asTeacher = await handlers['get-class-summary'](request, { log: makeMockLog(), error: mock.fn() });
        const teacherBody = JSON.parse(asTeacher.body);
        assert.strictEqual(teacherBody.publicationState, 'publicado', 'el docente ve el mismo estado que su clase');
    } finally {
        storageMocks.loadJson.mock.mockImplementation(restoreLoadJson);
        stateStoreMocks.getEnrollment.mock.mockImplementation(restoreEnrollment);
        process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: [] }));
    }
});

test('#507 residual: un derivado ausente no contradice a su clase publicada (mapa)', async () => {
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';
    const restoreLoadJson = storageMocks.loadJson.mock.mockImplementation;
    const restoreEnrollment = stateStoreMocks.getEnrollment.mock.mockImplementation;
    storageMocks.loadJson.mock.mockImplementation(async (container, blob) => {
        if (container === 'classes-config' && blob === 'arq-software-2026.json') {
            return [{ id: 'class-02', title: 'Clase 2', publicationState: 'publicado', summaryReady: true }];
        }
        return null;
    });
    stateStoreMocks.getEnrollment.mock.mockImplementation(async () => ({ status: 'active', role: 'student' }));
    const request = {
        params: { classId: 'class-02' },
        query: { get: (key) => (key === 'subjectId' ? 'arq-software-2026' : null) },
    };

    try {
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Estudiante'], userId: 'alu-005' }));
        const asStudent = await handlers['get-class-map'](request, { log: makeMockLog(), error: mock.fn() });
        const body = JSON.parse(asStudent.body);
        assert.strictEqual(asStudent.status, 200);
        assert.strictEqual(body.publicationState, 'publicado', 'el mapa ausente hereda el estado de su clase');
        assert.notStrictEqual(body.hidden, true, 'una clase publicada no oculta su mapa ausente');
        assert.strictEqual(body.mapCode, null, 'no se inventa contenido: sigue sin haber mapa');
    } finally {
        storageMocks.loadJson.mock.mockImplementation(restoreLoadJson);
        stateStoreMocks.getEnrollment.mock.mockImplementation(restoreEnrollment);
        process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: [] }));
    }
});

test('#507 residual: un derivado ausente no contradice a su clase publicada (podcast)', async () => {
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';
    const restoreLoadJson = storageMocks.loadJson.mock.mockImplementation;
    const restoreEnrollment = stateStoreMocks.getEnrollment.mock.mockImplementation;
    storageMocks.loadJson.mock.mockImplementation(async (container, blob) => {
        if (container === 'classes-config' && blob === 'arq-software-2026.json') {
            return [{ id: 'class-02', title: 'Clase 2', publicationState: 'publicado', summaryReady: true }];
        }
        return null;
    });
    stateStoreMocks.getEnrollment.mock.mockImplementation(async () => ({ status: 'active', role: 'student' }));
    const request = {
        params: { classId: 'class-02' },
        query: { get: (key) => (key === 'subjectId' ? 'arq-software-2026' : null) },
    };

    try {
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Estudiante'], userId: 'alu-005' }));
        const asStudent = await handlers['get-class-audio-script'](request, { log: makeMockLog(), error: mock.fn() });
        const body = JSON.parse(asStudent.body);
        assert.strictEqual(asStudent.status, 200);
        assert.strictEqual(body.publicationState, 'publicado', 'el guión ausente hereda el estado de su clase');
        assert.notStrictEqual(body.hidden, true, 'una clase publicada no oculta su guión ausente');
        assert.strictEqual(body.script, null, 'no se inventa contenido: sigue sin haber guión');
    } finally {
        storageMocks.loadJson.mock.mockImplementation(restoreLoadJson);
        stateStoreMocks.getEnrollment.mock.mockImplementation(restoreEnrollment);
        process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: [] }));
    }
});

test('#507 residual (control): un derivado ausente de una clase en borrador sigue en borrador', async () => {
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';
    const restoreLoadJson = storageMocks.loadJson.mock.mockImplementation;
    const restoreEnrollment = stateStoreMocks.getEnrollment.mock.mockImplementation;
    storageMocks.loadJson.mock.mockImplementation(async (container, blob) => {
        if (container === 'classes-config' && blob === 'arq-software-2026.json') {
            return [{ id: 'class-03', title: 'Clase 3', publicationState: 'borrador', summaryReady: false }];
        }
        return null;
    });
    stateStoreMocks.getEnrollment.mock.mockImplementation(async () => ({ status: 'active', role: 'student' }));
    const request = {
        params: { classId: 'class-03' },
        query: { get: (key) => (key === 'subjectId' ? 'arq-software-2026' : null) },
    };

    try {
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Estudiante'], userId: 'alu-005' }));
        const asStudent = await handlers['get-class-summary'](request, { log: makeMockLog(), error: mock.fn() });
        const body = JSON.parse(asStudent.body);
        assert.strictEqual(asStudent.status, 200);
        // El arreglo no vuelve visible todo: sin activo propio y con la clase en
        // borrador, el derivado sigue en borrador.
        assert.strictEqual(body.publicationState, 'borrador', 'sin activo propio y con la clase en borrador, sigue en borrador');
    } finally {
        storageMocks.loadJson.mock.mockImplementation(restoreLoadJson);
        stateStoreMocks.getEnrollment.mock.mockImplementation(restoreEnrollment);
        process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: [] }));
    }
});

test('#428: guardar la lista de clases no puede publicar ni retirar por su cuenta', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Docente'], userId: 'prof-001', userDetails: 'prof01@uade.edu.ar' }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';
    const restoreLoadJson = storageMocks.loadJson.mock.mockImplementation;
    const restoreEnrollment = stateStoreMocks.getEnrollment.mock.mockImplementation;
    storageMocks.loadJson.mock.mockImplementation(async (container, blob) => {
        if (container === 'classes-config' && blob === 'arq-software-2026.json') {
            return [{ id: 'class-01', title: 'Clase 1', publicationState: 'publicado', summaryReady: true }];
        }
        return null;
    });
    stateStoreMocks.getEnrollment.mock.mockImplementation(async () => ({ status: 'active', role: 'teacher' }));

    try {
        const res = await handlers['save-classes'](
            { params: { subjectId: 'arq-software-2026' }, json: async () => ([{ id: 'class-01', title: 'Clase 1 renombrada', summaryReady: false, publicationState: 'borrador' }]) },
            { log: makeMockLog(), error: mock.fn() }
        );
        assert.strictEqual(res.status, 200);
        const savedClass = JSON.parse(res.body).classes[0];
        assert.strictEqual(savedClass.publicationState, 'publicado', 'el estado guardado se conserva');
        assert.strictEqual(savedClass.summaryReady, true, 'el espejo sigue al estado, no al payload');
    } finally {
        storageMocks.loadJson.mock.mockImplementation(restoreLoadJson);
        stateStoreMocks.getEnrollment.mock.mockImplementation(restoreEnrollment);
        process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
    }
});

// UJ-19: retirar una clase publicada tiene que retirar también su aviso de
// publicación (el que dice "ya tiene resumen validado"). Antes, "Guardar
// Borrador" sacaba la clase de la unidad pero el aviso seguía afirmando que el
// resumen estaba validado y no llegaba ningún aviso de retiro a la cohorte.
test('UJ-19: save-class-summary retira el aviso de la clase al despublicarla', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Docente'] }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';
    const restoreLoadJson = storageMocks.loadJson.mock.mockImplementation;
    storageMocks.saveJson.mock.resetCalls();
    notificationStoreMocks.retractClassSummaryNotification.mock.resetCalls();
    storageMocks.loadJson.mock.mockImplementation(async (container, blob) => {
        if (container === 'classes-config' && blob === 'arq-software-2026.json') {
            return [{ id: 'class-01', title: 'Clase 1', summaryReady: true }];
        }
        if (container === 'class-summaries') return { classId: 'class-01', summary: 'previo', validated: true };
        return {};
    });

    try {
        const res = await handlers['save-class-summary'](
            { params: { classId: 'class-01' }, json: async () => ({ subjectId: 'arq-software-2026', summary: 'borrador', publicationState: 'borrador' }) },
            { log: makeMockLog(), error: mock.fn() }
        );
        assert.strictEqual(res.status, 200);
        assert.strictEqual(notificationStoreMocks.retractClassSummaryNotification.mock.callCount(), 1, 'debe retirar el aviso de la clase');
        const arg = notificationStoreMocks.retractClassSummaryNotification.mock.calls[0].arguments[0];
        assert.strictEqual(arg.subjectId, 'arq-software-2026');
        assert.strictEqual(arg.classData.id, 'class-01');
    } finally {
        storageMocks.loadJson.mock.mockImplementation(restoreLoadJson);
        process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
    }
});

test('UJ-19: save-class-summary no retira el aviso si la clase sigue publicada', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Docente'] }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';
    const restoreLoadJson = storageMocks.loadJson.mock.mockImplementation;
    storageMocks.saveJson.mock.resetCalls();
    notificationStoreMocks.retractClassSummaryNotification.mock.resetCalls();
    storageMocks.loadJson.mock.mockImplementation(async (container, blob) => {
        if (container === 'classes-config' && blob === 'arq-software-2026.json') {
            return [{ id: 'class-01', title: 'Clase 1', summaryReady: true }];
        }
        if (container === 'class-summaries') return { classId: 'class-01', summary: 'previo', validated: true };
        return {};
    });

    try {
        const res = await handlers['save-class-summary'](
            { params: { classId: 'class-01' }, json: async () => ({ subjectId: 'arq-software-2026', summary: 'sin cambios de estado', validated: true }) },
            { log: makeMockLog(), error: mock.fn() }
        );
        assert.strictEqual(res.status, 200);
        assert.strictEqual(notificationStoreMocks.retractClassSummaryNotification.mock.callCount(), 0, 'no debe retirar el aviso de una clase publicada');
    } finally {
        storageMocks.loadJson.mock.mockImplementation(restoreLoadJson);
        process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
    }
});
test('#391: retirar un material deja constancia y no lo borra; reponer la conserva', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Docente'], userDetails: 'prof01@uade.edu.ar' }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';
    const restoreGetMaterial = stateStoreMocks.getMaterialState.mock.mockImplementation;
    const restoreUpsert = stateStoreMocks.upsertMaterialState.mock.mockImplementation;
    stateStoreMocks.upsertMaterialState.mock.mockImplementation(async (material) => material);
    stateStoreMocks.getMaterialState.mock.mockImplementation(async () => ({
        subjectId: 'arq-software-2026',
        materialId: 'mat-vieja',
        classIds: ['class-04'],
        type: 'notes',
        filename: 'uj09-fuente-obsoleta.txt',
        status: 'ready',
        reviewed: true,
        priority: 'primary',
    }));

    try {
        const request = (body) => ({
            params: { materialId: 'mat-vieja' },
            json: async () => body,
        });

        const retirado = await handlers['update-material'](
            request({ subjectId: 'arq-software-2026', retirementState: 'retirada', retireReason: 'reemplazada por la guía 2026-10' }),
            { log: makeMockLog(), error: mock.fn() }
        );
        assert.strictEqual(retirado.status, 200);
        const retiradoBody = JSON.parse(retirado.body);
        assert.strictEqual(retiradoBody.retirement.state, 'retirada');
        assert.strictEqual(retiradoBody.retirement.previousState, 'activa');
        assert.strictEqual(retiradoBody.retirement.by, 'prof01@uade.edu.ar', 'queda registrado quién retiró');
        assert.ok(retiradoBody.retirement.at, 'queda registrado cuándo');
        assert.strictEqual(retiradoBody.retirement.reason, 'reemplazada por la guía 2026-10');

        const primeraEscritura = stateStoreMocks.upsertMaterialState.mock.calls.at(-1).arguments[0];
        assert.strictEqual(primeraEscritura.retirementState, 'retirada');
        assert.strictEqual(primeraEscritura.retireReason, 'reemplazada por la guía 2026-10');
        assert.strictEqual(primeraEscritura.priority, 'primary', 'retirar no es ponderar: la prioridad no se toca');
        assert.strictEqual(primeraEscritura.filename, 'uj09-fuente-obsoleta.txt', 'retirar no borra el archivo');

        // Se puede reponer, conservando el rastro de las dos decisiones.
        stateStoreMocks.getMaterialState.mock.mockImplementation(async () => ({
            subjectId: 'arq-software-2026',
            materialId: 'mat-vieja',
            classIds: ['class-04'],
            type: 'notes',
            filename: 'uj09-fuente-obsoleta.txt',
            status: 'ready',
            reviewed: true,
            priority: 'primary',
            retirementState: 'retirada',
            retirementHistory: primeraEscritura.retirementHistory,
            retiredBy: 'prof01@uade.edu.ar',
            retiredAt: '2026-10-16T12:00:00.000Z',
            retireReason: 'reemplazada por la guía 2026-10',
        }));

        const repuesto = await handlers['update-material'](
            request({ subjectId: 'arq-software-2026', retirementState: 'activa' }),
            { log: makeMockLog(), error: mock.fn() }
        );
        const repuestoBody = JSON.parse(repuesto.body);
        assert.strictEqual(repuestoBody.retirement.state, 'activa');
        const segundaEscritura = stateStoreMocks.upsertMaterialState.mock.calls.at(-1).arguments[0];
        assert.strictEqual(segundaEscritura.retirementHistory.length, 2, 'la constancia del retiro se conserva');
        assert.strictEqual(segundaEscritura.retirementHistory[0].action, 'retirar');
        assert.strictEqual(segundaEscritura.retirementHistory[1].action, 'reponer');
    } finally {
        stateStoreMocks.getMaterialState.mock.mockImplementation(restoreGetMaterial);
        stateStoreMocks.upsertMaterialState.mock.mockImplementation(restoreUpsert);
        process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
    }
});

test('#343: get-subjects fails closed for anonymous callers (401, no catalog leak)', async (t) => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => null);
    const restoreLoadJson = storageMocks.loadJson.mock.mockImplementation;
    storageMocks.loadJson.mock.mockImplementation(async () => ([
        { id: 'arq-software-2026', name: 'Arquitectura', professors: ['Prof A'] },
    ]));
    const mockContext = { log: makeMockLog(), error: mock.fn(), warn: mock.fn() };
    try {
        const response = await handlers['get-subjects']({ headers: new Map() }, mockContext);
        assert.strictEqual(response.status, 401);
        const body = JSON.parse(response.body);
        assert.strictEqual(body.code, 'AUTH_REQUIRED');
    } finally {
        storageMocks.loadJson.mock.mockImplementation(async () => ({}));
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: [] }));
    }
});

test('#343: get-subjects treats Admin as unscoped (full catalog)', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({
        userId: 'admin-1', userRoles: ['authenticated', 'Admin'], groups: [],
    }));
    stateStoreMocks.getEnrollmentsByUser.mock.mockImplementation(async () => []);
    storageMocks.loadJson.mock.mockImplementation(async () => ([
        { id: 's1', name: 'S1', group: 'g1' },
        { id: 's2', name: 'S2', group: 'g2' },
        { id: 'dasi-1c2023', name: 'DASI', group: 'g3' },
        { id: 's4', name: 'S4', group: '' },
    ]));
    const mockContext = { log: makeMockLog(), error: mock.fn(), warn: mock.fn() };
    try {
        const response = await handlers['get-subjects']({ headers: new Map() }, mockContext);
        assert.strictEqual(response.status, 200);
        const body = JSON.parse(response.body);
        assert.strictEqual(body.length, 4, 'Admin must see the full catalog');
    } finally {
        storageMocks.loadJson.mock.mockImplementation(async () => ({}));
        stateStoreMocks.getEnrollmentsByUser.mock.mockImplementation(async () => []);
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: [] }));
    }
});

// #433: el camino de negación no puede depender de `context.log.warn`. En el
// host desplegado ese método deja la invocación sin respuesta; cuando la llamada
// cae dentro del try del chequeo de matrícula, la excepción la convierte en un
// 500 donde correspondía un 403.
test('#433: material-status niega con 403 aunque el host no tenga context.log.warn', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'anonymous', userRoles: [] }));
    stateStoreMocks.getEnrollment.mock.mockImplementation(async () => null);

    // El host real: `context.log` es una función callable y NO tiene .warn.
    const log = mock.fn();
    const mockContext = { log, error: mock.fn() };

    try {
        const single = await handlers['get-material-status'](
            { params: { materialId: 'mat-01' }, query: new Map([['subjectId', 'arq-software-2026']]) },
            mockContext
        );
        assert.strictEqual(single.status, 403, `esperaba 403, llegó ${single.status}: ${single.body}`);

        const batch = await handlers['get-material-status-batch'](
            { params: {}, query: new Map([['subjectId', 'arq-software-2026'], ['materialIds', 'mat-01']]) },
            mockContext
        );
        assert.strictEqual(batch.status, 403, `esperaba 403, llegó ${batch.status}: ${batch.body}`);
    } finally {
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: [] }));
        stateStoreMocks.getEnrollment.mock.mockImplementation(async () => null);
    }
});

// ── UJ-54: la fuente de consumo no disponible se declara, no se rellena con cero ──
test('classes-api computeDirectorMetrics marks a failed SessionMetrics read instead of reporting zero consumption (UJ-54)', async () => {
    const { computeDirectorMetrics } = await import('./classes-api.js');
    storageMocks.getTableClient.mock.mockImplementation(() => ({
        listEntities: () => { throw new Error('SessionMetrics unavailable'); },
    }));
    try {
        const metrics = await computeDirectorMetrics({ log: makeMockLog(), error: mock.fn() }, 30);
        assert.strictEqual(metrics.readError, 'SessionMetrics unavailable');
        assert.strictEqual(metrics.totals.totalCost, 0);
    } finally {
        storageMocks.getTableClient.mock.mockImplementation(() => ({ listEntities: defaultListEntities }));
    }
});

test('classes-api get-director-stats declares sourceState.readable=false when SessionMetrics cannot be read (UJ-54)', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));
    storageMocks.getTableClient.mock.mockImplementation((table) => {
        if (table === 'SessionMetrics') return { listEntities: () => { throw new Error('SessionMetrics unavailable'); } };
        return { listEntities: defaultListEntities, createTable: async () => {} };
    });
    try {
        const response = await handlers['get-director-stats']({ params: {}, query: new Map() }, { log: makeMockLog(), error: mock.fn() });
        assert.strictEqual(response.status, 200);
        const payload = JSON.parse(response.body);
        assert.strictEqual(payload.sourceState.readable, false);
        assert.match(payload.sourceState.error, /unavailable/);
        assert.deepStrictEqual(payload.costBySubject, []);
        assert.strictEqual(payload.budget.currentSpend, 0);
    } finally {
        storageMocks.getTableClient.mock.mockImplementation(() => ({ listEntities: defaultListEntities }));
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: [] }));
    }
});

test('classes-api get-director-stats declares sourceState.readable=true when SessionMetrics is read (UJ-54)', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));
    storageMocks.getTableClient.mock.mockImplementation(() => ({ listEntities: defaultListEntities, createTable: async () => {} }));
    try {
        const response = await handlers['get-director-stats']({ params: {}, query: new Map() }, { log: makeMockLog(), error: mock.fn() });
        assert.strictEqual(response.status, 200);
        const payload = JSON.parse(response.body);
        assert.strictEqual(payload.sourceState.readable, true);
        assert.strictEqual(payload.sourceState.error, null);
    } finally {
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: [] }));
    }
});

// #564: el inventario de la clase sale de la tabla de materiales. Si el
// borrado del estado falla, el material sigue listado: la respuesta no puede
// decir success:true.
test('classes-api delete-material falla si el estado sigue en el inventario (#564)', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Docente'] }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';

    const material = {
        materialId: 'mat-fantasma',
        subjectId: 'arq-software-2026',
        filename: '392-prueba.txt',
        blobUrl: 'https://stacc.blob.core.windows.net/class-materials/arq-software-2026/mat-fantasma.txt',
        classIds: ['class-01'],
        chunkCount: 0,
    };
    stateStoreMocks.getMaterialStateById.mock.mockImplementation(async () => material);
    stateStoreMocks.deleteMaterialStateById.mock.mockImplementation(async () => false);

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: { materialId: 'mat-fantasma' } };

    const response = await handlers['delete-material'](mockRequest, mockContext);

    assert.strictEqual(response.status, 500, 'no puede responder 200 si el material sigue en la clase');
    const body = JSON.parse(response.body);
    assert.notStrictEqual(body.success, true, 'la respuesta no debe afirmar éxito');
    assert.strictEqual(body.code, 'MATERIAL_STATE_DELETE_FAILED');

    stateStoreMocks.getMaterialStateById.mock.mockImplementation(async () => null);
    stateStoreMocks.deleteMaterialStateById.mock.mockImplementation(async () => true);
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
});

test('classes-api delete-material es idempotente cuando la fila ya no estaba (#564)', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Docente'] }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';

    // Primer lookup (atribución/cuota) encuentra el estado; el segundo, después
    // del borrado, confirma que ya no está aunque deleteMaterialStateById diga false.
    stateStoreMocks.getMaterialStateById.mock.mockImplementationOnce(async () => ({
        materialId: 'mat-ya-borrado',
        subjectId: 'arq-software-2026',
        filename: 'clase.pdf',
        chunkCount: 1,
    }));
    stateStoreMocks.getMaterialStateById.mock.mockImplementationOnce(async () => null);
    stateStoreMocks.deleteMaterialStateById.mock.mockImplementation(async () => false);

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: { materialId: 'mat-ya-borrado' } };

    const response = await handlers['delete-material'](mockRequest, mockContext);

    assert.strictEqual(response.status, 200);
    assert.strictEqual(JSON.parse(response.body).success, true);

    stateStoreMocks.getMaterialStateById.mock.mockImplementation(async () => null);
    stateStoreMocks.deleteMaterialStateById.mock.mockImplementation(async () => true);
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
});

// ── #538 / UJ-56 pasos 4, 7 y 9: el borrado deja constancia ───────────────

function constanciasEscritas() {
    return storageMocks.saveJson.mock.calls
        .map((call) => call.arguments)
        .filter(([container, blob]) => container === 'compliance' && String(blob).startsWith('deletions/'));
}

test('delete-material: Admin ejecuta el borrado (rol que responde por el cumplimiento) y deja constancia', async (t) => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({
        userId: 'adm-001',
        userDetails: 'admin@uade.edu.ar',
        userRoles: ['authenticated', 'Admin'],
    }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';
    stateStoreMocks.getMaterialStateById.mock.mockImplementation(async () => ({
        materialId: 'mat-538',
        subjectId: 'arq-software-2026',
        filename: 'rv3-538.txt',
        type: 'notes',
        classIds: ['class-01'],
        blobUrl: 'https://stacc.blob.core.windows.net/class-materials/arq-software-2026/mat-538.txt',
        chunkCount: 1,
        uploadedBy: 'prof-001',
        fileSize: 27,
    }));
    stateStoreMocks.deleteMaterialStateById.mock.mockImplementation(async () => true);

    const mockContext = { log: makeMockLog(), error: mock.fn(), correlationId: 'corr-538' };
    const mockRequest = { params: { materialId: 'mat-538' } };

    const response = await handlers['delete-material'](mockRequest, mockContext);
    assert.strictEqual(response.status, 200, 'Admin debe poder ejecutar el borrado');

    const body = JSON.parse(response.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.deletionRecorded, true);
    assert.match(body.deletionRecordId, /^\d{8}T\d{9}-mat-538-[a-f0-9]{6}$/);

    const escritas = constanciasEscritas().filter(([, blob]) => blob === `deletions/${body.deletionRecordId}.json`);
    assert.strictEqual(escritas.length, 1, 'el borrado debe dejar exactamente una constancia con ese id');
    const [container, blob, record] = escritas[0];
    assert.strictEqual(container, 'compliance');
    assert.strictEqual(blob, `deletions/${body.deletionRecordId}.json`);
    assert.strictEqual(record.action, 'material-delete');
    assert.strictEqual(record.outcome, 'deleted');
    assert.ok(record.requestedAt, 'la constancia lleva fecha del pedido');
    assert.strictEqual(record.actor.id, 'adm-001');
    assert.strictEqual(record.actor.email, 'admin@uade.edu.ar');
    assert.deepStrictEqual(record.authorization.allowedRoles, ['Docente', 'Director', 'Admin']);
    assert.strictEqual(record.target.materialId, 'mat-538');
    assert.strictEqual(record.target.subjectId, 'arq-software-2026');
    assert.strictEqual(record.target.filename, 'rv3-538.txt');
    assert.deepStrictEqual(record.scope.blobsMoved, ['deleted/arq-software-2026/mat-538.txt', 'deleted/mat-538.json']);
    assert.strictEqual(record.scope.chunkCount, 1);
    assert.strictEqual(typeof record.scope.vectorsDeleted, 'boolean');
    assert.strictEqual(record.scope.stateDeleted, true);
    assert.strictEqual(record.retention.declaredDays, 7);
    assert.strictEqual(record.retention.containerPurgeDays, 30);
    // withCorrelation usa uuid v4 (mockeado a '1234' en este archivo): la
    // constancia queda atada a la misma correlación que el resto del pedido.
    assert.strictEqual(record.correlationId, '1234');

    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: [] }));
    stateStoreMocks.getMaterialStateById.mock.mockImplementation(async () => null);
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
});

test('delete-material: una repetición queda registrada como already-absent, no como borrado', async (t) => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'prof-001', userRoles: ['Docente'] }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';
    stateStoreMocks.getMaterialStateById.mock.mockImplementation(async () => null);
    stateStoreMocks.deleteMaterialStateById.mock.mockImplementation(async () => false);
    storageMocks.moveBlob.mock.mockImplementation(async () => false);

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: { materialId: 'mat-repetido' } };

    const response = await handlers['delete-material'](mockRequest, mockContext);
    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.deepStrictEqual(body.softDeleted, []);

    const [, , record] = constanciasEscritas().find(([, blob]) => blob === `deletions/${body.deletionRecordId}.json`);
    assert.strictEqual(record.outcome, 'already-absent');
    assert.deepStrictEqual(record.scope.blobsMoved, []);
    assert.strictEqual(record.scope.chunkCount, 0);

    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: [] }));
    stateStoreMocks.deleteMaterialStateById.mock.mockImplementation(async () => true);
    storageMocks.moveBlob.mock.mockImplementation(async () => true);
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
});

test('delete-material: si la constancia no se puede escribir, el borrado vale igual y lo declara', async (t) => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'adm-001', userRoles: ['Admin'] }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';
    stateStoreMocks.getMaterialStateById.mock.mockImplementation(async () => ({
        materialId: 'mat-sin-constancia',
        subjectId: 'arq-software-2026',
        filename: 'x.txt',
        chunkCount: 1,
    }));
    stateStoreMocks.deleteMaterialStateById.mock.mockImplementation(async () => true);
    storageMocks.saveJson.mock.mockImplementation(async () => { throw new Error('storage caído'); });

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: { materialId: 'mat-sin-constancia' } };

    const response = await handlers['delete-material'](mockRequest, mockContext);
    assert.strictEqual(response.status, 200, 'el borrado no se revierte por no poder asentar la constancia');
    const body = JSON.parse(response.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.deletionRecorded, false);
    assert.ok(body.deletionRecordId, 'se informa el id para poder reclamar la constancia faltante');

    storageMocks.saveJson.mock.mockImplementation(async () => true);
    stateStoreMocks.getMaterialStateById.mock.mockImplementation(async () => null);
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: [] }));
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
});

test('delete-material: el borrado parcial se registra como partial con el error', async (t) => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'adm-001', userRoles: ['Admin'] }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';
    const material = { materialId: 'mat-parcial', subjectId: 'arq-software-2026', filename: 'x.txt', chunkCount: 2 };
    stateStoreMocks.getMaterialStateById.mock.mockImplementation(async () => material);
    stateStoreMocks.deleteMaterialStateById.mock.mockImplementation(async () => { throw new Error('tabla caída'); });

    const mockContext = { log: makeMockLog(), error: mock.fn() };
    const mockRequest = { params: { materialId: 'mat-parcial' } };

    const response = await handlers['delete-material'](mockRequest, mockContext);
    assert.strictEqual(response.status, 500);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.code, 'MATERIAL_STATE_DELETE_FAILED');
    assert.strictEqual(body.deletionRecorded, true);

    const [, , record] = constanciasEscritas().find(([, blob]) => blob === `deletions/${body.deletionRecordId}.json`);
    assert.strictEqual(record.outcome, 'partial');
    assert.strictEqual(record.scope.stateDeleted, false);
    assert.ok(record.scope.errors.some((e) => e.startsWith('estado:')), 'la constancia explica qué falló');

    stateStoreMocks.getMaterialStateById.mock.mockImplementation(async () => null);
    stateStoreMocks.deleteMaterialStateById.mock.mockImplementation(async () => true);
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: [] }));
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
});
