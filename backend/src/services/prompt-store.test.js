import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// Cliente de tabla en memoria: prompt-store habla con Azure Table Storage por
// `getTableClient`, así que el doble alcanza para verificar qué se escribe.
let entities = [];
const tableClient = {
    createTable: async () => {},
    getEntity: async (partitionKey, rowKey) => {
        const found = entities.find((e) => e.partitionKey === partitionKey && e.rowKey === rowKey);
        if (!found) {
            const err = new Error('Not found');
            err.statusCode = 404;
            throw err;
        }
        return { ...found };
    },
    createEntity: async (entity) => { entities.push({ ...entity }); },
    updateEntity: async (entity) => {
        const index = entities.findIndex((e) => e.partitionKey === entity.partitionKey && e.rowKey === entity.rowKey);
        if (index < 0) throw new Error('Not found');
        entities[index] = { ...entities[index], ...entity };
    },
    deleteEntity: async (partitionKey, rowKey) => {
        entities = entities.filter((e) => !(e.partitionKey === partitionKey && e.rowKey === rowKey));
    },
    listEntities: () => ({
        [Symbol.asyncIterator]: async function* () {
            for (const entity of entities) yield { ...entity };
        },
    }),
};

mock.module('./storage.js', { namedExports: { getTableClient: mock.fn(() => tableClient) } });

const { activateVersion, updateVersion, listVersions, deleteVersion } = await import('./prompt-store.js');

const T0 = '2026-06-29T20:06:15.282Z';
const TYPE = 'rag-master';

function seed() {
    entities = [
        { partitionKey: TYPE, rowKey: 'v1-baseline', content: 'A', isActive: true, createdAt: T0, updatedAt: T0, variables: '[]' },
        { partitionKey: TYPE, rowKey: 'v2-propuesta', content: 'B', isActive: false, createdAt: T0, updatedAt: T0, variables: '[]' },
    ];
}

const versionOf = (id) => entities.find((e) => e.rowKey === id);

test('activar deja constancia de quién, cuándo y por qué', async () => {
    seed();

    const record = await activateVersion(TYPE, 'v2-propuesta', { activatedBy: 'adm-001', reason: 'el tono nuevo es más claro' });

    assert.strictEqual(record.isActive, true);
    assert.strictEqual(record.activatedBy, 'adm-001');
    assert.strictEqual(record.reason, 'el tono nuevo es más claro');
    assert.ok(record.activatedAt, 'el momento de la activación queda registrado');

    const activated = versionOf('v2-propuesta');
    assert.strictEqual(activated.isActive, true);
    assert.strictEqual(activated.activatedBy, 'adm-001');
    assert.strictEqual(activated.activationReason, 'el tono nuevo es más claro');
    assert.ok(activated.activatedAt);

    const retired = versionOf('v1-baseline');
    assert.strictEqual(retired.isActive, false, 'la versión anterior deja de regir');
    assert.strictEqual(retired.deactivatedBy, 'adm-001');
    assert.ok(retired.deactivatedAt, 'también queda el momento en que dejó de regir');
});

test('activar NO pisa la fecha de actualización: la columna no confunde activación con edición (#454)', async () => {
    seed();

    await activateVersion(TYPE, 'v2-propuesta', { activatedBy: 'adm-001', reason: 'probando' });

    assert.strictEqual(versionOf('v2-propuesta').updatedAt, T0, 'el contenido de la activada no cambió');
    assert.strictEqual(versionOf('v1-baseline').updatedAt, T0, 'el contenido de la retirada tampoco cambió');
});

test('la vuelta atrás queda asentada con su motivo', async () => {
    seed();
    await activateVersion(TYPE, 'v2-propuesta', { activatedBy: 'adm-001', reason: 'probando el tono nuevo' });

    await activateVersion(TYPE, 'v1-baseline', { activatedBy: 'dir-001', reason: 'el tono nuevo no sirvió en el caso concreto' });

    assert.strictEqual(versionOf('v1-baseline').isActive, true);
    assert.strictEqual(versionOf('v1-baseline').activationReason, 'el tono nuevo no sirvió en el caso concreto');
    assert.strictEqual(versionOf('v2-propuesta').isActive, false);

    const restored = await listVersions(TYPE);
    const baseline = restored.find((v) => v.versionId === 'v1-baseline');
    const historial = baseline.activationHistory.map((entry) => entry.action);
    assert.deepStrictEqual(historial, ['deactivate', 'activate'], 'el rastro de ida y vuelta queda en la versión');
    assert.strictEqual(baseline.activationHistory.at(-1).by, 'dir-001');
    assert.strictEqual(baseline.activationHistory.at(-1).reason, 'el tono nuevo no sirvió en el caso concreto');
});

test('guardar sin cambios no mueve updatedAt; editar de verdad sí y registra a quién', async () => {
    seed();

    const sinCambios = await updateVersion(TYPE, 'v2-propuesta', { content: 'B', updatedBy: 'adm-001' });
    assert.strictEqual(sinCambios.contentChanged, false);
    assert.strictEqual(versionOf('v2-propuesta').updatedAt, T0, 'guardar lo mismo no puede fingir una edición');

    const conCambios = await updateVersion(TYPE, 'v2-propuesta', { content: 'B mejorado', updatedBy: 'adm-001' });
    assert.strictEqual(conCambios.contentChanged, true);
    assert.notStrictEqual(versionOf('v2-propuesta').updatedAt, T0);
    assert.strictEqual(versionOf('v2-propuesta').updatedBy, 'adm-001');
    assert.strictEqual(JSON.parse(versionOf('v2-propuesta').activationHistory).at(-1).action, 'edit');
});

test('la versión que rige no se puede borrar (sigue protegida)', async () => {
    seed();

    await assert.rejects(
        () => deleteVersion(TYPE, 'v1-baseline'),
        /No se puede eliminar la versión activa/,
    );
    assert.ok(versionOf('v1-baseline'), 'sigue existiendo');
});
