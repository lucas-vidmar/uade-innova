import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert';

// #419 (UJ-43): "Clases procesadas" tiene que salir del criterio acordado
// (al menos un derivado avalado por el docente) y no del total de clases.

const classRows = [];
const blobs = new Map(); // '<contenedor>/<blob>' -> asset | Error (Error = existe pero no se puede leer)

const storageMocks = {
    getTableClient: mock.fn(() => ({
        listEntities: () => ({
            [Symbol.asyncIterator]: async function* () {
                for (const row of classRows) yield row;
            },
        }),
    })),
    listBlobs: mock.fn(async (container) => [...blobs.keys()]
        .map(key => key.split('/'))
        .filter(([c]) => c === container)
        .map(([c, ...rest]) => rest.join('/'))),
    loadJson: mock.fn(async (container, name) => {
        const value = blobs.get(`${container}/${name}`);
        if (value instanceof Error) throw value;
        return value ?? null;
    }),
};

mock.module('../services/storage.js', { namedExports: storageMocks });
mock.module('../services/config.js', { namedExports: { CONFIG: { tables: { classes: 'classes' } } } });

const { computeClassProcessingStats, CLASS_PROCESSED_CRITERIA } = await import('./class-processing.js');

const context = { log: { warn: mock.fn(() => {}) } };

function reset({ rows = [], entries = [] } = {}) {
    classRows.length = 0;
    classRows.push(...rows);
    blobs.clear();
    for (const [key, value] of entries) blobs.set(key, value);
}

function counts(result) {
    return {
        cargadas: result.totalClasses,
        procesadas: result.processedClasses,
        noCalculables: result.notComputableClasses,
    };
}

beforeEach(() => {
    reset();
});

test('clase con una síntesis avalada por el docente cuenta como procesada', async () => {
    reset({
        rows: [{ partitionKey: 'arq-software-2026', rowKey: 'class-01', summaryReady: false }],
        entries: [['class-summaries/arq-software-2026/class-01.json', { classId: 'class-01', subjectId: 'arq-software-2026', summary: 'Síntesis', validated: true }]],
    });

    const result = await computeClassProcessingStats(context);
    assert.deepStrictEqual(counts(result), { cargadas: 1, procesadas: 1, noCalculables: 0 });
});

test('clase con material cargado pero sin derivado avalado es cargada, no procesada', async () => {
    reset({
        rows: [
            { partitionKey: 'arq-software-2026', rowKey: 'class-02', summaryReady: false },
            { partitionKey: 'arq-software-2026', rowKey: 'class-03', summaryReady: false },
        ],
        entries: [
            // Síntesis y mapa generados por IA, todavía sin aval del docente.
            ['class-summaries/arq-software-2026/class-02.json', { classId: 'class-02', summary: 'Borrador IA' }],
            ['class-maps/arq-software-2026/class-02.json', { classId: 'class-02', mapCode: 'graph TD' }],
            // Guardado como borrador por el docente: validated === false.
            ['class-summaries/arq-software-2026/class-03.json', { classId: 'class-03', summary: 'Borrador docente', validated: false }],
        ],
    });

    const result = await computeClassProcessingStats(context);
    assert.deepStrictEqual(counts(result), { cargadas: 2, procesadas: 0, noCalculables: 0 });
});

test('un mapa avalado alcanza: la clase es procesada aunque la síntesis no esté avalada', async () => {
    reset({
        rows: [{ partitionKey: 'diseno-sistemas-2026', rowKey: 'class-07', summaryReady: false }],
        entries: [
            ['class-summaries/diseno-sistemas-2026/class-07.json', { classId: 'class-07', summary: 'Borrador', validated: false }],
            ['class-maps/diseno-sistemas-2026/class-07.json', { classId: 'class-07', mapCode: 'graph TD', validated: true }],
        ],
    });

    const result = await computeClassProcessingStats(context);
    assert.deepStrictEqual(counts(result), { cargadas: 1, procesadas: 1, noCalculables: 0 });
});

test('la marca de aprobación de la clase (publicada por el docente) también cuenta', async () => {
    reset({
        rows: [{ partitionKey: 'eco-internacional-2026', rowKey: 'class-11', summaryReady: true }],
        entries: [],
    });

    const result = await computeClassProcessingStats(context);
    assert.deepStrictEqual(counts(result), { cargadas: 1, procesadas: 1, noCalculables: 0 });
});

test('un derivado que existe pero no se puede leer se informa como no calculable, no se cuenta', async () => {
    reset({
        rows: [{ partitionKey: 'arq-software-2026', rowKey: 'class-04', summaryReady: false }],
        entries: [['class-summaries/arq-software-2026/class-04.json', new Error('storage unavailable')]],
    });

    const result = await computeClassProcessingStats(context);
    assert.deepStrictEqual(counts(result), { cargadas: 1, procesadas: 0, noCalculables: 1 });
});

test('una fila sin identificador de clase no se puede calcular', async () => {
    reset({ rows: [{ partitionKey: 'arq-software-2026' }] });

    const result = await computeClassProcessingStats(context);
    assert.deepStrictEqual(counts(result), { cargadas: 1, procesadas: 0, noCalculables: 1 });
});

test('un blob heredado de otra materia no avala la clase (#328)', async () => {
    reset({
        rows: [{ partitionKey: 'arq-software-2026', rowKey: 'class-01', summaryReady: false }],
        entries: [['class-summaries/class-01.json', { classId: 'class-01', subjectId: 'dasi-1c2023', summary: 'Otra materia', validated: true }]],
    });

    const result = await computeClassProcessingStats(context);
    assert.deepStrictEqual(counts(result), { cargadas: 1, procesadas: 0, noCalculables: 0 });
    // El nombre scoped tenía prioridad: no se listó, así que no se leyó el heredado.
    assert.strictEqual(blobs.size, 1);
});

test('el blob heredado de la misma materia sí se usa cuando no hay nombre scoped', async () => {
    reset({
        rows: [{ partitionKey: 'arq-software-2026', rowKey: 'class-05', summaryReady: false }],
        entries: [['class-maps/class-05.json', { classId: 'class-05', subjectId: 'arq-software-2026', mapCode: 'graph TD', validated: true }]],
    });

    const result = await computeClassProcessingStats(context);
    assert.deepStrictEqual(counts(result), { cargadas: 1, procesadas: 1, noCalculables: 0 });
});

test('si el nombre scoped existe, manda sobre el heredado', async () => {
    reset({
        rows: [{ partitionKey: 'arq-software-2026', rowKey: 'class-06', summaryReady: false }],
        entries: [
            ['class-summaries/arq-software-2026/class-06.json', { classId: 'class-06', summary: 'Sin aval', validated: false }],
            ['class-summaries/class-06.json', { classId: 'class-06', summary: 'Avalado viejo', validated: true }],
        ],
    });

    const result = await computeClassProcessingStats(context);
    assert.deepStrictEqual(counts(result), { cargadas: 1, procesadas: 0, noCalculables: 0 });
});

test('el conteo devuelve el criterio aplicado para que la pantalla lo pueda declarar', async () => {
    const result = await computeClassProcessingStats(context);
    assert.strictEqual(result.criteria, CLASS_PROCESSED_CRITERIA);
    assert.match(result.criteria, /síntesis o un mapa avalado por el docente/);
});
