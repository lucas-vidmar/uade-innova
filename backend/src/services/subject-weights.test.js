import { test, mock } from 'node:test';
import assert from 'node:assert';

// ── UJ-11 paso 6 (issue #371) ────────────────────────────────────────────────
// La ponderación de fuentes tiene que quedar con quién la fijó, cuándo y con qué
// fundamento, para que otra persona pueda revisarla y volver atrás con motivo.

const store = {
    entity: null,
    upserts: [],
};

const storageMocks = {
    getTableClient: mock.fn(() => ({
        createTable: mock.fn(async () => {}),
        getEntity: mock.fn(async () => {
            if (!store.entity) {
                const err = new Error('Not found');
                err.statusCode = 404;
                throw err;
            }
            return store.entity;
        }),
        upsertEntity: mock.fn(async (entity) => {
            store.upserts.push(entity);
            store.entity = entity;
        }),
    })),
};

mock.module('./storage.js', { namedExports: storageMocks });

const { getSubjectWeights, upsertSubjectWeights, validateWeights } = await import('./subject-weights.js');

test('getSubjectWeights sin fila devuelve defaults sin responsable', async () => {
    store.entity = null;
    const result = await getSubjectWeights('arq-software-2026');
    assert.strictEqual(result.defaults, true);
    assert.strictEqual(result.updatedBy, null);
    assert.strictEqual(result.reason, '');
});

test('upsertSubjectWeights guarda motivo, autor y fecha, y getSubjectWeights los devuelve', async () => {
    store.entity = null;
    store.upserts.length = 0;

    const saved = await upsertSubjectWeights(
        'arq-software-2026',
        { notes: 1.35, bibliography: 1.1, transcript: 1.2, presentation: 0.95 },
        'prof-002',
        '  Las diapositivas repiten la version vieja del modelo de capas.  ',
    );

    assert.strictEqual(saved.updatedBy, 'prof-002');
    assert.strictEqual(saved.reason, 'Las diapositivas repiten la version vieja del modelo de capas.');
    assert.ok(saved.updatedAt);

    const read = await getSubjectWeights('arq-software-2026');
    assert.strictEqual(read.defaults, false);
    assert.strictEqual(read.weights.transcript, 1.2);
    assert.strictEqual(read.updatedBy, 'prof-002');
    assert.strictEqual(read.reason, 'Las diapositivas repiten la version vieja del modelo de capas.');
    assert.strictEqual(read.updatedAt, saved.updatedAt);
});

test('upsertSubjectWeights guarda el estado anterior para poder volver atrás con motivo', async () => {
    await upsertSubjectWeights('arq-software-2026', { notes: 2, bibliography: 1, transcript: 1, presentation: 1 }, 'prof-002', 'Subo apuntes');
    await upsertSubjectWeights('arq-software-2026', { notes: 1.35, bibliography: 1.1, transcript: 1, presentation: 0.95 }, 'prof-002', 'Vuelvo a la ponderación anterior');

    const entity = store.upserts.at(-1);
    assert.ok(entity.previousWeights, 'queda el estado anterior');
    assert.strictEqual(JSON.parse(entity.previousWeights).notes, 2);
    assert.strictEqual(entity.reason, 'Vuelvo a la ponderación anterior');
});

test('validateWeights sigue rechazando valores fuera de rango', async () => {
    const result = validateWeights({ notes: 9 });
    assert.strictEqual(result.valid, false);
});
