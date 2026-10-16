import { test, mock } from 'node:test';
import assert from 'node:assert';

// ── UJ-17 paso 4 ─────────────────────────────────────────────────────────────
// El tramo rechazado queda intacto Y con el motivo del rechazo registrado:
// sin motivo la decisión no es revisable por otra persona (issue #374).

const authUtilsMocks = {
    validateFrontDoorId: mock.fn(() => true),
    setStashedIdentity: mock.fn(() => {}),
    parseClientPrincipal: mock.fn(() => ({ userId: 'prof-002', userRoles: ['Docente'] })),
};

const upsertCalls = [];
const storageMocks = {
    getTableClient: mock.fn(() => ({
        getEntity: mock.fn(async () => ({
            partitionKey: 'arq-software-2026',
            rowKey: 'tc-1',
            status: 'pending',
            subjectId: 'arq-software-2026',
            materialId: 'mat-1',
            classId: 'class-03',
            fragment: 'probandó',
            suggestedFix: 'probando',
        })),
        upsertEntity: mock.fn(async (entity) => { upsertCalls.push(entity); }),
    })),
};

mock.module('../../../services/auth-utils.js', { namedExports: authUtilsMocks });
mock.module('../../../services/storage.js', { namedExports: storageMocks });

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

await import('./index.js');

function makeRequest(body) {
    return { json: async () => body, headers: { get: () => null }, method: 'POST' };
}

const context = { log: mock.fn(), error: mock.fn() };

test('reject-suggestion registra el motivo del rechazo junto con quien decidió', async () => {
    upsertCalls.length = 0;
    const response = await handlers['reject-transcription-suggestion'](
        makeRequest({ suggestionId: 'tc-1', subjectId: 'arq-software-2026', reason: '  el alumno dijo probandó, no probando  ' }),
        context,
    );

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.data.status, 'rejected');
    assert.strictEqual(body.data.rejectionReason, 'el alumno dijo probandó, no probando');

    assert.strictEqual(upsertCalls.length, 1);
    assert.strictEqual(upsertCalls[0].status, 'rejected');
    assert.strictEqual(upsertCalls[0].rejectionReason, 'el alumno dijo probandó, no probando');
    assert.strictEqual(upsertCalls[0].teacherId, 'prof-002');
    assert.ok(upsertCalls[0].resolvedAt, 'la fecha de la decisión queda registrada');
});

test('reject-suggestion rechaza la petición sin motivo', async () => {
    upsertCalls.length = 0;
    const response = await handlers['reject-transcription-suggestion'](
        makeRequest({ suggestionId: 'tc-1', subjectId: 'arq-software-2026' }),
        context,
    );

    assert.strictEqual(response.status, 400);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.error.code, 'INVALID_INPUT');
    assert.strictEqual(upsertCalls.length, 0, 'no debe escribir nada sin motivo');
});

test('reject-suggestion rechaza una sugerencia ya resuelta', async () => {
    upsertCalls.length = 0;
    storageMocks.getTableClient.mock.mockImplementationOnce(() => ({
        getEntity: mock.fn(async () => ({ partitionKey: 'arq-software-2026', rowKey: 'tc-1', status: 'applied' })),
        upsertEntity: mock.fn(async (entity) => { upsertCalls.push(entity); }),
    }));
    const response = await handlers['reject-transcription-suggestion'](
        makeRequest({ suggestionId: 'tc-1', subjectId: 'arq-software-2026', reason: 'no corresponde' }),
        context,
    );

    assert.strictEqual(response.status, 409);
    assert.strictEqual(upsertCalls.length, 0);
});
