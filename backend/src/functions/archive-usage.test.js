import { test, mock } from 'node:test';
import assert from 'node:assert';

// #343: el archivo en frío quedó abierto sólo a Director. Admin es un rol
// global desde la corrección del alcance, pero al pedir /api/archive-usage
// recibía 403 y la pantalla lo mostraba como "sin datos". El gate tiene que
// admitir a los dos roles sin abrirlo a ningún otro.
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

const authOptions = [];
mock.module('../middleware/with-auth.js', {
    namedExports: {
        withAuth: (handler, options = {}) => {
            authOptions.push(options);
            return handler;
        },
    },
});

const authUtilsMocks = {
    validateFrontDoorId: mock.fn(() => true),
};
mock.module('../services/auth-utils.js', { namedExports: authUtilsMocks });

const archiveMocks = {
    getArchiveUsage: mock.fn(async () => ({
        totalArchiveBlobs: 3,
        totalArchiveSizeGB: 1.5,
        bySubject: [{ subjectId: 'arq-software-2026', blobs: 3 }],
        bySemester: [],
    })),
};
mock.module('../services/archive-usage.js', { namedExports: archiveMocks });

await import('./archive-usage.js');

const handler = captured['archive-usage'].handler;

function makeContext() {
    return { log: mock.fn(), error: mock.fn(), warn: mock.fn() };
}

function makeRequest(query = {}) {
    return { query: { get: (key) => query[key] } };
}

test('#343: archive-usage admite Director y Admin, y a nadie más', () => {
    assert.deepEqual(authOptions[0]?.roles, ['Director', 'Admin'],
        'el endpoint tiene que admitir Admin (antes sólo Director) y no abrirse a otros roles');
});

test('#343: archive-usage devuelve el uso del archivo al rol habilitado', async () => {
    const response = await handler(makeRequest({ subjectId: 'arq-software-2026', semester: '2026-1' }), makeContext());

    assert.strictEqual(response.status, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.totalArchiveBlobs, 3);
    assert.strictEqual(body.totalArchiveSizeGB, 1.5);
    assert.deepEqual(archiveMocks.getArchiveUsage.mock.calls.at(-1).arguments[0], {
        subjectId: 'arq-software-2026',
        semester: '2026-1',
    });
});

test('#343: una falla del servicio se informa con el motivo, no como archivo vacío', async () => {
    const original = archiveMocks.getArchiveUsage.mock.mockImplementation;
    archiveMocks.getArchiveUsage.mock.mockImplementation(async () => { throw new Error('blob unreachable'); });
    try {
        const response = await handler(makeRequest(), makeContext());
        assert.strictEqual(response.status, 500);
        const body = JSON.parse(response.body);
        assert.strictEqual(body.error, 'blob unreachable');
        assert.strictEqual(body.totalArchiveBlobs, 0);
    } finally {
        archiveMocks.getArchiveUsage.mock.mockImplementation(original);
    }
});
