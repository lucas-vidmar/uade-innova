/**
 * caudal-wiring.test.js — qué endpoint pasa por qué eje (#458)
 *
 * Los topes no sirven de nada si el endpoint no está envuelto, o si está
 * envuelto con el tier equivocado: durante meses `ingest` estuvo declarado en
 * config y el tope real de la ingesta fue el general. Esto fija el cableado.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const srcDir = resolve(process.cwd(), 'src');

async function read(relativePath) {
    return readFile(resolve(srcDir, relativePath), 'utf8');
}

/** Devuelve el texto del handler `app.http('<name>', { … })` hasta el siguiente handler. */
function handlerBlock(source, name) {
    const start = source.indexOf(`app.http('${name}', {`);
    assert.notEqual(start, -1, `no se encontró el handler ${name}`);
    const next = source.indexOf('\napp.http(', start + 1);
    return source.slice(start, next === -1 ? source.length : next);
}

test('el caudal interactivo declara su tier: rag-query y generate-quiz usan chat', async () => {
    const rag = await read('functions/rag-query.js');
    const ragBlock = handlerBlock(rag, 'rag-query');
    assert.match(ragBlock, /withRateLimit\(withAuth\(/);
    assert.match(ragBlock, /'chat'\)\)/);

    const quiz = await read('functions/quiz-api.js');
    const quizBlock = handlerBlock(quiz, 'generate-quiz');
    assert.match(quizBlock, /withRateLimit\(async/);
    assert.match(quizBlock, /'chat'\)\)/);
});

test('la ingesta usa el tier ingest, no el general', async () => {
    const src = await read('functions/ingest-material.js');
    const block = handlerBlock(src, 'ingest-material');
    assert.match(block, /withRateLimit\(withAuth\(/);
    assert.match(block, /'ingest'\)\)/);
});

test('lo esencial pasa por el limitador: material-download, material-status y classes', async () => {
    const download = await read('functions/material-download.js');
    assert.match(handlerBlock(download, 'material-download'), /withRateLimit\(withAuth\(/);

    const classes = await read('functions/classes-api.js');
    for (const name of ['get-classes', 'get-material-status', 'get-material-status-batch', 'post-material-status-batch']) {
        assert.match(handlerBlock(classes, name), /withRateLimit\(withAuth\(/, `${name} no pasa por el limitador`);
    }
});

test('la superficie de operación está registrada y es de sólo lectura', async () => {
    const index = await read('index.js');
    assert.match(index, /import '\.\/functions\/caudal-api\.js';/);

    const api = await read('functions/caudal-api.js');
    assert.match(api, /route: 'dashboard-admin\/caudal'/);
    assert.match(api, /methods: \['GET'\]/);
    assert.match(api, /roles: OPERATOR_ROLES/);
    assert.match(api, /const OPERATOR_ROLES = \['Admin', 'Director', 'Security'\]/);
});

test('la configuración declara los dos ejes, la reserva y el umbral', async () => {
    const config = await read('config.js');
    assert.match(config, /essential: Number\(process\.env\.RATE_LIMIT_ESSENTIAL_PER_MIN\)/);
    assert.match(config, /totalPerWindow: Number\(process\.env\.RATE_LIMIT_SERVICE_PER_MIN\)/);
    assert.match(config, /reservePct: Number\(process\.env\.RATE_LIMIT_RESERVE_PCT\)/);
    assert.match(config, /alertThresholdPct: Number\(process\.env\.RATE_LIMIT_ALERT_THRESHOLD_PCT\)/);
    assert.match(config, /eventsTable: process\.env\.AZURE_TABLE_RATE_LIMIT_EVENTS/);
});
