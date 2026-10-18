/**
 * El host de Azure Functions registra una ruta solo si el modulo que la declara
 * fue importado por el entry point. Un modulo con `app.http(...)` que nadie
 * importa existe en el repo, pasa sus propias pruebas (que mockean
 * `@azure/functions` y capturan los handlers sin pasar por `index.js`) y
 * responde 404 en el piloto. Asi entro `access-review-api.js` (#549): la
 * superficie de revision de permisos dio 404 en produccion con la suite verde.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const functionsDir = path.join(dir, 'functions');
const indexSource = fs.readFileSync(path.join(dir, 'index.js'), 'utf8');

function modulosQueRegistranRutas() {
    return fs.readdirSync(functionsDir)
        .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
        .filter((f) => fs.readFileSync(path.join(functionsDir, f), 'utf8').includes('app.http('));
}

test('todo modulo de functions que registra rutas esta importado en index.js (#549)', () => {
    const sinImportar = modulosQueRegistranRutas().filter((f) => !indexSource.includes(`./functions/${f}`));
    assert.deepStrictEqual(
        sinImportar,
        [],
        `modulos con app.http que nadie importa (responden 404 en el piloto): ${sinImportar.join(', ')}`,
    );
});

test('la lista de modulos que registran rutas no esta vacia (el control tiene con que trabajar)', () => {
    assert.strictEqual(modulosQueRegistranRutas().length > 20, true);
});
