import { test } from 'node:test';
import assert from 'node:assert';

import {
    resolveRagGenerationConfig,
    describeGenerationConfig,
    RAG_TEMPERATURE,
    DETERMINISM,
} from './rag-generation-config.js';
import { CONFIG } from '../config.js';

// #408/UJ-27: lo que se declara tiene que ser lo que se le pide al modelo. Estos
// tests fijan el contrato del bloque (`generation`) que viaja en cada respuesta.

test('#408: la configuración declarada pide temperature 0 y conserva el tope de tokens', () => {
    const generation = resolveRagGenerationConfig({
        model: 'deepseek-v4-flash',
        modelLabel: 'DeepSeek-V4.1-Flash',
        maxTokens: 1500,
        promptVersion: 'v1-baseline',
    });

    assert.strictEqual(RAG_TEMPERATURE, 0);
    assert.strictEqual(generation.temperature, 0);
    assert.strictEqual(generation.maxTokens, 1500);
    assert.strictEqual(generation.model, 'deepseek-v4-flash');
    assert.strictEqual(generation.modelLabel, 'DeepSeek-V4.1-Flash');
    assert.strictEqual(generation.promptVersion, 'v1-baseline');
    assert.strictEqual(generation.determinism, DETERMINISM.TEMPERATURE_ZERO);
});

test('#408: top_p no se declara como propio porque no se envía', () => {
    const generation = resolveRagGenerationConfig({ model: 'deepseek-v4-flash', maxTokens: 400 });
    assert.strictEqual(generation.topP, null);
    assert.strictEqual(generation.topPSource, 'proveedor');
});

test('#408: la etiqueta legible dice modelo, temperatura, tope y versión del prompt', () => {
    const generation = resolveRagGenerationConfig({
        model: 'deepseek-v4-flash',
        modelLabel: 'DeepSeek-V4.1-Flash',
        maxTokens: 400,
        promptVersion: 'v3',
    });
    assert.strictEqual(
        generation.label,
        'DeepSeek-V4.1-Flash · temperatura 0 · máx. 400 tokens · prompt v3',
    );
    assert.strictEqual(describeGenerationConfig(generation), `Powered by ${generation.label}`);
});

test('#408: sin modelLabel cae al nombre del deployment, y sin maxTokens al default del servicio', () => {
    const generation = resolveRagGenerationConfig({ model: 'deepseek-v4-flash' });
    assert.strictEqual(generation.modelLabel, 'deepseek-v4-flash');
    assert.strictEqual(generation.maxTokens, CONFIG.ai.maxTokens.chat);
    assert.match(generation.label, /deepseek-v4-flash/);
});

test('#408: el fast-path de glosario se declara sin modelo', () => {
    const generation = resolveRagGenerationConfig({ determinism: DETERMINISM.GLOSSARY });
    assert.strictEqual(generation.model, null);
    assert.strictEqual(generation.temperature, null);
    assert.strictEqual(generation.maxTokens, null);
    assert.strictEqual(generation.determinism, 'glosario-sin-modelo');
    assert.match(generation.label, /sin modelo generativo/);
    assert.strictEqual(describeGenerationConfig(generation), generation.label);
});

test('#408: el rechazo sin fragmentos se declara como "no se llamó al modelo"', () => {
    const generation = resolveRagGenerationConfig({ determinism: DETERMINISM.NO_CONTEXT });
    assert.strictEqual(generation.model, null);
    assert.strictEqual(generation.temperature, null);
    assert.strictEqual(generation.determinism, 'rechazo-sin-contexto');
    assert.match(generation.label, /no se llamó al modelo/);
});

test('#408: el bloque declarado es inmutable', () => {
    const generation = resolveRagGenerationConfig({ model: 'deepseek-v4-flash', maxTokens: 1500 });
    assert.strictEqual(Object.isFrozen(generation), true);
    assert.throws(() => { 'use strict'; generation.temperature = 0.7; }, TypeError);
});
