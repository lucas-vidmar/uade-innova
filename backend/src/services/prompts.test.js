import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// La resolución del prompt que gobierna una consulta: la activa responde, y sólo
// el banco de pruebas puede pedir otra versión sin activarla (UJ-48 / UJ-49, #453).
const storeMocks = {
    getActive: mock.fn(async () => null),
    getVersion: mock.fn(async () => null),
    listTypes: mock.fn(async () => []),
    listVersions: mock.fn(async () => []),
    createVersion: mock.fn(async () => ({})),
    updateVersion: mock.fn(async () => ({})),
    activateVersion: mock.fn(async () => ({})),
    deleteVersion: mock.fn(async () => ({})),
};

mock.module('./prompt-store.js', { namedExports: storeMocks });

const { resolveRagPrompt, DEFAULT_RAG_SYSTEM_PROMPT } = await import('./prompts.js');

test('sin versión pedida responde la versión ACTIVA y se declara su procedencia', async () => {
    storeMocks.getActive.mock.mockImplementation(async (type) => {
        assert.strictEqual(type, 'rag-master');
        return { versionId: 'v1-baseline', content: 'PROMPT VIGENTE', model: null };
    });

    const prompt = await resolveRagPrompt();

    assert.strictEqual(prompt.id, 'v1-baseline');
    assert.strictEqual(prompt.content, 'PROMPT VIGENTE');
    assert.strictEqual(prompt.source, 'active');
    assert.strictEqual(storeMocks.getVersion.mock.callCount(), 0, 'no debe buscar versiones cuando no se pide ninguna');
});

test('una versión pedida se usa tal cual está guardada, sin activarla', async () => {
    storeMocks.getVersion.mock.mockImplementation(async (type, versionId) => {
        assert.strictEqual(type, 'rag-master');
        return { versionId, content: 'PROMPT PROPUESTO (sin activar)', model: null };
    });
    const activeCalls = storeMocks.getActive.mock.callCount();

    const prompt = await resolveRagPrompt({ versionId: 'v-propuesta' });

    assert.strictEqual(prompt.id, 'v-propuesta');
    assert.strictEqual(prompt.content, 'PROMPT PROPUESTO (sin activar)');
    assert.strictEqual(prompt.source, 'requested');
    assert.strictEqual(storeMocks.getActive.mock.callCount(), activeCalls, 'probar una propuesta no consulta el estado activo');
    assert.strictEqual(storeMocks.activateVersion.mock.callCount(), 0, 'probar una propuesta no activa nada');
});

test('si la versión pedida no existe se sigue con la activa y se declara el origen', async () => {
    storeMocks.getVersion.mock.mockImplementation(async () => null);
    storeMocks.getActive.mock.mockImplementation(async () => ({ versionId: 'v1-baseline', content: 'PROMPT VIGENTE', model: null }));

    const prompt = await resolveRagPrompt({ versionId: 'v-no-existe' });

    assert.strictEqual(prompt.id, 'v1-baseline');
    assert.strictEqual(prompt.source, 'active', 'el origen distinto de "requested" es lo que permite rechazar la petición');
});

test('sin ninguna versión activa devuelve un prompt por defecto, nunca undefined', async () => {
    storeMocks.getVersion.mock.mockImplementation(async () => null);
    storeMocks.getActive.mock.mockImplementation(async () => null);

    const prompt = await resolveRagPrompt();

    assert.strictEqual(prompt.id, 'default');
    assert.strictEqual(prompt.source, 'default');
    assert.strictEqual(prompt.content, DEFAULT_RAG_SYSTEM_PROMPT);
    assert.ok(typeof prompt.content === 'string' && prompt.content.length > 0);
});
