import { test } from 'node:test';
import assert from 'node:assert';

import {
    PUBLICATION_STATES,
    applyPublicationStateToAsset,
    isPublicationState,
    isPublished,
    normalizePublicationState,
    resolveAssetPublicationState,
    resolveClassPublicationState,
} from './publication-state.js';

test('#428: el estado de publicación tiene exactamente tres valores', () => {
    assert.deepStrictEqual(PUBLICATION_STATES, ['borrador', 'pendiente_de_aval', 'publicado']);
    assert.strictEqual(isPublicationState('publicado'), true);
    assert.strictEqual(isPublicationState('vigente'), false);
    assert.strictEqual(isPublicationState(undefined), false);
});

test('#428: los datos heredados se interpretan como publicado sólo si su booleano estaba en true', () => {
    assert.strictEqual(normalizePublicationState('pendiente_de_aval', true), 'pendiente_de_aval');
    assert.strictEqual(normalizePublicationState(undefined, true), 'publicado');
    assert.strictEqual(normalizePublicationState(undefined, false), 'borrador');
    assert.strictEqual(normalizePublicationState('cualquier-cosa', true), 'publicado');
});

test('#428: la clase y el derivado responden al mismo estado', () => {
    assert.strictEqual(resolveClassPublicationState({ summaryReady: true }), 'publicado');
    assert.strictEqual(resolveClassPublicationState({ summaryReady: false }), 'borrador');
    assert.strictEqual(resolveClassPublicationState({ publicationState: 'pendiente_de_aval', summaryReady: true }), 'pendiente_de_aval');
    assert.strictEqual(resolveAssetPublicationState({ validated: true }), 'publicado');
    assert.strictEqual(resolveAssetPublicationState({ publicationState: 'borrador', validated: true }), 'borrador');
    assert.strictEqual(isPublished('publicado'), true);
    assert.strictEqual(isPublished('pendiente_de_aval'), false);
});

test('#428: la transición deja constancia de quién, cuándo y por qué, y acumula el historial', () => {
    const original = { classId: 'class-01', summary: '# Resumen', validated: true, publicationState: 'publicado' };
    const retirado = applyPublicationStateToAsset(original, {
        state: 'borrador',
        by: 'prof01@uade.edu.ar',
        at: '2026-10-16T12:00:00.000Z',
        reason: 'guía reemplazada',
    });

    assert.strictEqual(retirado.publicationState, 'borrador');
    assert.strictEqual(retirado.validated, false);
    assert.strictEqual(retirado.publicationChangedBy, 'prof01@uade.edu.ar');
    assert.strictEqual(retirado.publicationChangedAt, '2026-10-16T12:00:00.000Z');
    assert.strictEqual(retirado.publicationChangedReason, 'guía reemplazada');
    assert.deepStrictEqual(retirado.publicationHistory.at(-1), {
        from: 'publicado',
        to: 'borrador',
        by: 'prof01@uade.edu.ar',
        at: '2026-10-16T12:00:00.000Z',
        reason: 'guía reemplazada',
    });
    // El contenido no se toca: retirar no borra.
    assert.strictEqual(retirado.summary, '# Resumen');

    const republicado = applyPublicationStateToAsset(retirado, {
        state: 'publicado',
        by: 'prof02@uade.edu.ar',
        at: '2026-10-17T09:00:00.000Z',
    });
    assert.strictEqual(republicado.publicationHistory.length, 2, 'la constancia previa se conserva');
    assert.strictEqual(republicado.validatedBy, 'prof02@uade.edu.ar');
    assert.strictEqual(republicado.validatedAt, '2026-10-17T09:00:00.000Z');
});
