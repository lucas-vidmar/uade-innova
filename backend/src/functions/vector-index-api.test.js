import { test, mock } from 'node:test';
import assert from 'node:assert';

// ── #452 / UJ-59 ────────────────────────────────────────────────────────────
// Superficie de inspección y reparación del índice de conocimiento por unidad:
// la lista de lo que el índice sirve para una unidad (con su veredicto contra el
// registro autoritativo) y la cuarentena verificada de los materiales que no le
// corresponden.

const authUtilsMocks = {
    validateFrontDoorId: mock.fn(() => true),
    setStashedIdentity: mock.fn(() => {}),
    readDevIdentityHeader: mock.fn(() => null),
    parseClientPrincipal: mock.fn(() => ({ userId: 'prof-002', userRoles: ['Docente'] })),
};

const storageMocks = {
    saveJson: mock.fn(async () => true),
    loadJson: mock.fn(async () => null),
};

const stateStoreMocks = {
    getMaterialState: mock.fn(async (subjectId, materialId) => {
        if (materialId === 'm-01' && subjectId === 'arq-software-2026') {
            return { subjectId, materialId, classIds: ['class-01'], type: 'transcript', filename: 'clase1.txt' };
        }
        if (materialId === 'm-02' && subjectId === 'arq-software-2026') {
            return { subjectId, materialId, classIds: ['class-02'], type: 'notes', filename: 'apuntes.txt' };
        }
        return null;
    }),
    getEnrollment: mock.fn(async () => ({ status: 'active', role: 'teacher' })),
};

// Índice en memoria: upsertChunks escribe y fetchVectorsByIds/listAllVectorIds leen.
const index = new Map();
const seedIndex = (id, metadata) => index.set(id, { values: [0.1, 0.2], metadata: { ...metadata } });

const vectorStoreMocks = {
    listAllVectorIds: mock.fn(async () => [...index.keys()]),
    fetchVectorsByIds: mock.fn(async (ids) => ({
        vectors: ids.filter((id) => index.has(id)).map((id) => ({ id, values: index.get(id).values, metadata: { ...index.get(id).metadata } })),
        missingIds: [],
    })),
    upsertChunks: mock.fn(async (vectors) => {
        for (const vector of vectors) index.set(vector.id, { values: vector.values, metadata: { ...vector.metadata } });
    }),
    getIndexStats: mock.fn(async () => ({ totalVectorCount: index.size, indexFullness: 0, namespaces: {} })),
};

const telemetryMocks = {
    trackVectorQuarantineRun: mock.fn(async () => {}),
};

mock.module('../services/auth-utils.js', { namedExports: authUtilsMocks });
mock.module('../services/storage.js', { namedExports: storageMocks });
mock.module('../services/state-store.js', { namedExports: stateStoreMocks });
mock.module('../services/vector-store.js', { namedExports: vectorStoreMocks });
mock.module('../services/telemetry.js', { namedExports: telemetryMocks });
mock.module('uuid', { namedExports: { v4: () => 'run-test' } });

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

function makeContext() {
    const error = mock.fn();
    return { error, warn: mock.fn(), log: mock.fn(), correlationId: 'corr-test' };
}

function makeRequest({ query = {}, body = null, method = 'GET' } = {}) {
    return {
        method,
        headers: { get: () => null },
        query: { get: (key) => query[key] ?? null },
        json: async () => body,
    };
}

const { collectSubjectVectors } = await import('./vector-index-api.js');

const cronograma = {
    subjectId: 'arq-software-2026',
    materialId: 'b619ef64-9ca8-4fd0-825b-a2c5fef75d2c',
    sourceFilename: 'DASI Cronograma dia Jueves_1C2023_ejemplo.docx',
    materialType: 'bibliography',
    classId: 'class-01',
    classIds: ['class-01', 'class-02'],
    chunkIndex: 0,
    text: 'Datos de la asignatura',
};

function resetIndex() {
    index.clear();
    seedIndex('cronograma-chunk-0', cronograma);
    seedIndex('propio-chunk-0', { subjectId: 'arq-software-2026', materialId: 'm-01', sourceFilename: 'clase1.txt', materialType: 'transcript', classId: 'class-01', classIds: ['class-01'] });
    seedIndex('desplazado-chunk-0', { subjectId: 'arq-software-2026', materialId: 'm-02', sourceFilename: 'apuntes.txt', materialType: 'notes', classId: 'class-04', classIds: ['class-04'] });
    seedIndex('otra-unidad-chunk-0', { subjectId: 'dasi-1c2023', materialId: 'x-01', sourceFilename: 'otra.txt', materialType: 'notes', classId: 'class-99', classIds: ['class-99'] });
    vectorStoreMocks.upsertChunks.mock.resetCalls();
    storageMocks.saveJson.mock.resetCalls();
    telemetryMocks.trackVectorQuarantineRun.mock.resetCalls();
}

test('vector-index lists the unit material with the verdict of each entry (UJ-59 paso 5)', async () => {
    resetIndex();
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'prof-002', userRoles: ['Docente'] }));

    const response = await handlers['vector-index'](makeRequest({ query: { subjectId: 'arq-software-2026' } }), makeContext());

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.subjectId, 'arq-software-2026');
    assert.strictEqual(body.truncated, false);
    // Sólo los vectores de la unidad: el de dasi-1c2023 no entra en la lista.
    assert.strictEqual(body.totalInUnit, 3);
    assert.strictEqual(typeof body.indexTotalVectorCount, 'number');
    assert.strictEqual(body.counts.orphan, 1);
    assert.strictEqual(body.counts.ok, 1);
    assert.strictEqual(body.counts.mismatch, 1);

    const orphan = body.groups.find((g) => g.materialId === cronograma.materialId);
    assert.strictEqual(orphan.verdict, 'orphan');
    assert.strictEqual(orphan.registered, false);
    assert.strictEqual(orphan.sourceFilename, 'DASI Cronograma dia Jueves_1C2023_ejemplo.docx');
    assert.ok(orphan.reasons.includes('no-authoritative-material'));

    const propio = body.groups.find((g) => g.materialId === 'm-01');
    assert.strictEqual(propio.verdict, 'ok');
    assert.deepStrictEqual(propio.reasons, []);

    const desplazado = body.groups.find((g) => g.materialId === 'm-02');
    assert.strictEqual(desplazado.verdict, 'mismatch');
    assert.ok(desplazado.reasons.includes('classId-mismatch'));
    assert.deepStrictEqual(desplazado.expectedClassIds, ['class-02']);
});

test('vector-index requires subjectId', async () => {
    const response = await handlers['vector-index'](makeRequest({ query: {} }), makeContext());
    assert.strictEqual(response.status, 400);
    assert.strictEqual(JSON.parse(response.body).code, 'MISSING_SUBJECT');
});

test('vector-index fails closed without identity', async () => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => null);
    const response = await handlers['vector-index'](makeRequest({ query: { subjectId: 'arq-software-2026' } }), makeContext());
    assert.strictEqual(response.status, 401);
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'prof-002', userRoles: ['Docente'] }));
});

test('vector-index requires an active enrollment for a docente of another unit', async () => {
    stateStoreMocks.getEnrollment.mock.mockImplementationOnce(async () => null);
    const response = await handlers['vector-index'](makeRequest({ query: { subjectId: 'dasi-1c2023' } }), makeContext());
    assert.strictEqual(response.status, 403);
    assert.strictEqual(JSON.parse(response.body).code, 'ENROLLMENT_INACTIVE');
});

test('vector-index allows Director without enrollment in the unit', async () => {
    resetIndex();
    authUtilsMocks.parseClientPrincipal.mock.mockImplementationOnce(() => ({ userId: 'dir-001', userRoles: ['Director'] }));
    const response = await handlers['vector-index'](makeRequest({ query: { subjectId: 'eco-internacional-2026' } }), makeContext());
    assert.strictEqual(response.status, 200);
});

test('collectSubjectVectors flags truncation instead of presenting a closed list', async () => {
    const many = Array.from({ length: 20001 }, (_, i) => `v-${i}`);
    const result = await collectSubjectVectors('arq-software-2026', {
        listAllVectorIds: async () => many,
        fetchVectorsByIds: async () => ({ vectors: [], missingIds: [] }),
    });
    assert.strictEqual(result.truncated, true);
    assert.strictEqual(result.scanned, 20000);
});

test('vector-index/quarantine takes the orphan material out of the index and verifies it (UJ-59 pasos 6 y 10)', async () => {
    resetIndex();
    const response = await handlers['vector-index-quarantine'](
        makeRequest({ method: 'POST', body: { subjectId: 'arq-software-2026', materialIds: [cronograma.materialId] } }),
        makeContext(),
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.applied.length, 1);
    assert.strictEqual(body.applied[0].verdict, 'orphan');
    assert.strictEqual(body.verification.verified, true);
    assert.deepStrictEqual(body.verification.remaining, []);
    assert.strictEqual(body.auditBlob, 'vector-quarantine/run-test-index-quarantine.json');

    // El índice quedó con la marca: la recuperación la excluye (buildPineconeFilter).
    assert.strictEqual(index.get('cronograma-chunk-0').metadata.quarantined, true);
    assert.strictEqual(index.get('cronograma-chunk-0').metadata.quarantineReason, 'no-authoritative-material');
    assert.strictEqual(index.get('cronograma-chunk-0').values.length, 2, 'no se pierden los valores del vector');

    // No tocó el material legítimo de la unidad.
    assert.strictEqual(index.get('propio-chunk-0').metadata.quarantined, undefined);

    // Registro de la corrida + telemetría.
    assert.strictEqual(storageMocks.saveJson.mock.callCount(), 1);
    assert.strictEqual(storageMocks.saveJson.mock.calls[0].arguments[0], 'vector-quarantine');
    const record = storageMocks.saveJson.mock.calls[0].arguments[2];
    assert.strictEqual(record.subjectId, 'arq-software-2026');
    assert.strictEqual(record.requestedBy, 'prof-002');
    assert.deepStrictEqual(record.applied[0].materialId, cronograma.materialId);
    assert.strictEqual(record.verification.verified, true);
    assert.strictEqual(telemetryMocks.trackVectorQuarantineRun.mock.callCount(), 1);
    assert.strictEqual(telemetryMocks.trackVectorQuarantineRun.mock.calls[0].arguments[0].success, true);
});

test('vector-index/quarantine is idempotent', async () => {
    resetIndex();
    const request = () => makeRequest({ method: 'POST', body: { subjectId: 'arq-software-2026', materialIds: [cronograma.materialId] } });
    await handlers['vector-index-quarantine'](request(), makeContext());
    vectorStoreMocks.upsertChunks.mock.resetCalls();

    const second = await handlers['vector-index-quarantine'](request(), makeContext());
    const body = JSON.parse(second.body);
    assert.strictEqual(body.applied.length, 0);
    assert.strictEqual(body.skipped[0].reason, 'ya-en-cuarentena');
    assert.strictEqual(vectorStoreMocks.upsertChunks.mock.callCount(), 0);
});

test('vector-index/quarantine refuses to touch a material without conflict unless force', async () => {
    resetIndex();
    const response = await handlers['vector-index-quarantine'](
        makeRequest({ method: 'POST', body: { subjectId: 'arq-software-2026', materialIds: ['m-01'] } }),
        makeContext(),
    );
    const body = JSON.parse(response.body);
    assert.strictEqual(body.applied.length, 0);
    assert.strictEqual(body.skipped[0].reason, 'sin-conflicto');
    assert.strictEqual(vectorStoreMocks.upsertChunks.mock.callCount(), 0);

    const forced = await handlers['vector-index-quarantine'](
        makeRequest({ method: 'POST', body: { subjectId: 'arq-software-2026', materialIds: ['m-01'], force: true } }),
        makeContext(),
    );
    assert.strictEqual(JSON.parse(forced.body).applied.length, 1);
});

test('vector-index/quarantine reports ids that are not in the unit instead of purging blindly', async () => {
    resetIndex();
    const response = await handlers['vector-index-quarantine'](
        makeRequest({ method: 'POST', body: { subjectId: 'arq-software-2026', materialIds: ['material-de-otra-unidad'] } }),
        makeContext(),
    );
    const body = JSON.parse(response.body);
    assert.strictEqual(body.applied.length, 0);
    assert.deepStrictEqual(body.notInUnit, ['material-de-otra-unidad']);
    assert.strictEqual(vectorStoreMocks.upsertChunks.mock.callCount(), 0);
});

test('vector-index/quarantine requires materialIds', async () => {
    const response = await handlers['vector-index-quarantine'](
        makeRequest({ method: 'POST', body: { subjectId: 'arq-software-2026', materialIds: [] } }),
        makeContext(),
    );
    assert.strictEqual(response.status, 400);
    assert.strictEqual(JSON.parse(response.body).code, 'MISSING_MATERIALS');
});

test('vector-index/quarantine rejects an invalid JSON body', async () => {
    const request = makeRequest({ method: 'POST' });
    request.json = async () => { throw new Error('bad json'); };
    const response = await handlers['vector-index-quarantine'](request, makeContext());
    assert.strictEqual(response.status, 400);
    assert.strictEqual(JSON.parse(response.body).code, 'INVALID_JSON');
});

// ── #452 / UJ-59: un escaneo ciego no puede presentarse como la verdad ──────
// En el piloto `POST /vectors/list` devolvió vacío mientras el índice declaraba
// 478 vectores: la superficie devolvía `scanned: 0` con la lista vacía y sin
// ninguna señal de fallo, como si la unidad no tuviera material indexado.

test('vector-index declares a blind scan instead of an empty authoritative list (UJ-59)', async () => {
    resetIndex();
    vectorStoreMocks.listAllVectorIds.mock.mockImplementationOnce(async () => []);
    vectorStoreMocks.getIndexStats.mock.mockImplementationOnce(async () => ({ totalVectorCount: 478, indexFullness: 0, namespaces: {} }));

    const response = await handlers['vector-index'](makeRequest({ query: { subjectId: 'arq-software-2026' } }), makeContext());

    assert.strictEqual(response.status, 502);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.code, 'INDEX_SCAN_INCOMPLETE');
    assert.strictEqual(body.scanned, 0);
    assert.strictEqual(body.indexTotalVectorCount, 478);
    assert.strictEqual(body.groups, undefined, 'no devuelve una lista vacía como verdad de la unidad');
});

test('vector-index does not flag an empty scan when the index is genuinely empty', async () => {
    resetIndex();
    vectorStoreMocks.listAllVectorIds.mock.mockImplementationOnce(async () => []);
    vectorStoreMocks.getIndexStats.mock.mockImplementationOnce(async () => ({ totalVectorCount: 0, indexFullness: 0, namespaces: {} }));

    const response = await handlers['vector-index'](makeRequest({ query: { subjectId: 'arq-software-2026' } }), makeContext());

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.scanned, 0);
    assert.strictEqual(body.indexTotalVectorCount, 0);
    assert.deepStrictEqual(body.groups, []);
});

test('vector-index still answers when the index total cannot be read', async () => {
    resetIndex();
    vectorStoreMocks.listAllVectorIds.mock.mockImplementationOnce(async () => []);
    vectorStoreMocks.getIndexStats.mock.mockImplementationOnce(async () => { throw new Error('stats unavailable'); });

    const response = await handlers['vector-index'](makeRequest({ query: { subjectId: 'arq-software-2026' } }), makeContext());

    assert.strictEqual(response.status, 200);
    assert.strictEqual(JSON.parse(response.body).indexTotalVectorCount, null);
});

test('vector-index/quarantine aborts on a blind scan instead of reporting materials as notInUnit (UJ-59 pasos 6-7)', async () => {
    resetIndex();
    vectorStoreMocks.listAllVectorIds.mock.mockImplementationOnce(async () => []);
    vectorStoreMocks.getIndexStats.mock.mockImplementationOnce(async () => ({ totalVectorCount: 478, indexFullness: 0, namespaces: {} }));

    const response = await handlers['vector-index-quarantine'](
        makeRequest({ method: 'POST', body: { subjectId: 'arq-software-2026', materialIds: [cronograma.materialId] } }),
        makeContext(),
    );

    assert.strictEqual(response.status, 502);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.code, 'INDEX_SCAN_INCOMPLETE');
    assert.strictEqual(body.indexTotalVectorCount, 478);
    assert.strictEqual(vectorStoreMocks.upsertChunks.mock.callCount(), 0, 'no purga a ciegas');
});
