import { test, mock } from 'node:test';
import assert from 'node:assert';

// #434: el GET de la ponderación se servía sin roles y sin mirar la identidad:
// un cliente sin sesión recibía la configuración vigente de la unidad.
const captured = {};

mock.module('@azure/functions', {
    namedExports: {
        app: {
            http: (name, options) => { captured[name] = options; },
        },
    },
});

mock.module('../middleware/with-correlation.js', {
    namedExports: { withCorrelation: (handler) => handler },
});

captured.authOptions = [];
const withAuthMocks = {
    withAuth: (handler, options) => {
        // El orden de registro del archivo es GET y después PUT.
        captured.authOptions.push(options);
        return handler;
    },
};
mock.module('../middleware/with-auth.js', { namedExports: withAuthMocks });

const authUtilsMocks = {
    validateFrontDoorId: mock.fn(() => true),
    parseClientPrincipal: mock.fn(() => null),
    getAuthenticatedUser: mock.fn(() => ({ userId: 'anonymous' })),
};
mock.module('../services/auth-utils.js', { namedExports: authUtilsMocks });

const stateStoreMocks = {
    getEnrollment: mock.fn(async () => null),
};
mock.module('../services/state-store.js', { namedExports: stateStoreMocks });

const subjectWeightsMocks = {
    getSubjectWeights: mock.fn(async () => ({ weights: { notes: 1.35 }, defaults: false })),
    upsertSubjectWeights: mock.fn(async () => ({ weights: {}, defaults: false })),
    DEFAULT_WEIGHTS: { notes: 1.35, bibliography: 1.1, transcript: 1, presentation: 0.95 },
};
mock.module('../services/subject-weights.js', { namedExports: subjectWeightsMocks });

await import('./subject-weights-api.js');

const getHandler = captured['subject-weights-get'].handler;

function makeContext() {
    return { log: mock.fn(), error: mock.fn(), warn: mock.fn() };
}

function makeRequest(subjectId = 'arq-software-2026') {
    return { params: { subjectId } };
}

function withEnv(fn) {
    const prev = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';
    return (async () => {
        try {
            return await fn();
        } finally {
            if (prev === undefined) delete process.env.AZURE_FUNCTIONS_ENVIRONMENT;
            else process.env.AZURE_FUNCTIONS_ENVIRONMENT = prev;
        }
    })();
}

test('#434: el GET de la ponderación exige rol (Docente/Director/Admin)', () => {
    // Primera ruta registrada = subject-weights-get.
    assert.deepEqual(captured.authOptions[0]?.roles, ['Docente', 'Director', 'Admin']);
});

test('#434: sin identidad no se sirve la ponderación de la unidad', async () => {
    await withEnv(async () => {
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => null);
        subjectWeightsMocks.getSubjectWeights.mock.resetCalls();

        const res = await getHandler(makeRequest(), makeContext());

        assert.strictEqual(res.status, 403, `esperaba 403, llegó ${res.status}: ${res.body}`);
        assert.match(res.body, /Se requiere rol Docente, Director o Admin/);
        assert.strictEqual(subjectWeightsMocks.getSubjectWeights.mock.callCount(), 0, 'no debe leer la configuración sin identidad');
    });
});

test('#434: una docente no asignada a la unidad no lee su ponderación', async () => {
    await withEnv(async () => {
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'prof-009', userRoles: ['authenticated', 'Docente'] }));
        authUtilsMocks.getAuthenticatedUser.mock.mockImplementation(() => ({ userId: 'prof-009' }));
        // getEnrollment consulta la unidad pedida: sin asignación devuelve null.
        stateStoreMocks.getEnrollment.mock.mockImplementation(async () => null);
        subjectWeightsMocks.getSubjectWeights.mock.resetCalls();

        const res = await getHandler(makeRequest(), makeContext());

        assert.strictEqual(res.status, 403, `esperaba 403, llegó ${res.status}: ${res.body}`);
        assert.match(res.body, /No estás asignado como docente/);
        assert.strictEqual(subjectWeightsMocks.getSubjectWeights.mock.callCount(), 0);
    });
});

test('#434: una docente con asignación inactiva no lee la ponderación', async () => {
    await withEnv(async () => {
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'prof-009', userRoles: ['authenticated', 'Docente'] }));
        authUtilsMocks.getAuthenticatedUser.mock.mockImplementation(() => ({ userId: 'prof-009' }));
        stateStoreMocks.getEnrollment.mock.mockImplementation(async () => ({ role: 'teacher', status: 'inactive' }));
        subjectWeightsMocks.getSubjectWeights.mock.resetCalls();

        const res = await getHandler(makeRequest(), makeContext());

        assert.strictEqual(res.status, 403, `esperaba 403, llegó ${res.status}: ${res.body}`);
        assert.strictEqual(subjectWeightsMocks.getSubjectWeights.mock.callCount(), 0);
    });
});

test('una docente asignada lee la ponderación de su unidad', async () => {
    await withEnv(async () => {
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'prof-001', userRoles: ['authenticated', 'Docente'] }));
        authUtilsMocks.getAuthenticatedUser.mock.mockImplementation(() => ({ userId: 'prof-001' }));
        stateStoreMocks.getEnrollment.mock.mockImplementation(async () => ({ role: 'teacher', status: 'active', subjectId: 'arq-software-2026' }));

        const res = await getHandler(makeRequest(), makeContext());

        assert.strictEqual(res.status, 200);
        assert.deepEqual(JSON.parse(res.body).data, { notes: 1.35 });
    });
});

test('quien conduce (Director) lee la ponderación sin matrícula', async () => {
    await withEnv(async () => {
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'dir-001', userRoles: ['authenticated', 'Director'] }));
        stateStoreMocks.getEnrollment.mock.mockImplementation(async () => null);

        const res = await getHandler(makeRequest(), makeContext());

        assert.strictEqual(res.status, 200);
    });
});

test('una alumna no lee la ponderación de la unidad', async () => {
    await withEnv(async () => {
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'alu-001', userRoles: ['authenticated', 'Alumno'] }));

        const res = await getHandler(makeRequest(), makeContext());

        assert.strictEqual(res.status, 403, `esperaba 403, llegó ${res.status}: ${res.body}`);
    });
});
