import { test } from 'node:test';
import assert from 'node:assert';

import {
    RETIREMENT_STATES,
    applyRetirementChange,
    excludeRetiredMatches,
    isRetiredMaterial,
    isRetirementState,
    normalizeRetirementState,
    parseRetirementHistory,
    partitionMaterialsByRetirement,
    resolveMaterialRetirement,
} from './material-retirement.js';

test('#391: el estado de retiro es propio del material y no reemplaza a la prioridad', () => {
    assert.deepStrictEqual(RETIREMENT_STATES, ['activa', 'retirada']);
    assert.strictEqual(isRetirementState('retirada'), true);
    assert.strictEqual(isRetirementState('secondary'), false, 'la prioridad no es un estado de retiro');
    assert.strictEqual(normalizeRetirementState(undefined), 'activa');
    assert.strictEqual(normalizeRetirementState('cualquiera'), 'activa');

    // Un material secundario sigue activo: ponderar no es retirar.
    const secundario = resolveMaterialRetirement({ priority: 'secondary' });
    assert.strictEqual(secundario.state, 'activa');
    assert.strictEqual(secundario.retired, false);
});

test('#391: retirar deja constancia de quién, cuándo y por qué, y no borra el material', () => {
    const original = { materialId: 'mat-1', filename: 'guia-2020.txt', extractedText: 'contenido viejo' };
    const retirado = applyRetirementChange(original, {
        state: 'retirada',
        by: 'prof01@uade.edu.ar',
        at: '2026-10-16T12:00:00.000Z',
        reason: 'reemplazada por la guía 2026-10',
    });

    assert.strictEqual(retirado.retirementState, 'retirada');
    assert.strictEqual(retirado.retiredBy, 'prof01@uade.edu.ar');
    assert.strictEqual(retirado.retiredAt, '2026-10-16T12:00:00.000Z');
    assert.strictEqual(retirado.retireReason, 'reemplazada por la guía 2026-10');
    assert.strictEqual(retirado.filename, 'guia-2020.txt', 'retirar no borra');
    assert.strictEqual(retirado.extractedText, 'contenido viejo');
    assert.strictEqual(isRetiredMaterial(retirado), true);
    assert.deepStrictEqual(retirado.retirementHistory.at(-1), {
        action: 'retirar',
        from: 'activa',
        to: 'retirada',
        by: 'prof01@uade.edu.ar',
        at: '2026-10-16T12:00:00.000Z',
        reason: 'reemplazada por la guía 2026-10',
    });
});

test('#391: reponer la fuente conserva el rastro del retiro y de la reposición', () => {
    const retirado = applyRetirementChange({ materialId: 'mat-1' }, {
        state: 'retirada', by: 'prof01@uade.edu.ar', at: '2026-10-16T12:00:00.000Z', reason: 'obsoleta',
    });
    const repuesto = applyRetirementChange(retirado, {
        state: 'activa', by: 'prof02@uade.edu.ar', at: '2026-10-17T09:00:00.000Z', reason: 'seguía vigente',
    });

    assert.strictEqual(repuesto.retirementState, 'activa');
    assert.strictEqual(isRetiredMaterial(repuesto), false);
    assert.strictEqual(repuesto.retirementHistory.length, 2, 'la constancia del retiro no se pierde');
    assert.strictEqual(repuesto.retirementHistory[0].action, 'retirar');
    assert.deepStrictEqual(repuesto.retirementHistory[1], {
        action: 'reponer',
        from: 'retirada',
        to: 'activa',
        by: 'prof02@uade.edu.ar',
        at: '2026-10-17T09:00:00.000Z',
        reason: 'seguía vigente',
    });
    // El último movimiento es el que manda para mostrar el responsable.
    const estado = resolveMaterialRetirement(repuesto);
    assert.strictEqual(estado.by, 'prof02@uade.edu.ar', 'el último movimiento manda para el responsable');
    assert.strictEqual(estado.lastAction, 'reponer');
    assert.strictEqual(estado.retiredBy, 'prof01@uade.edu.ar', 'la constancia del retiro se conserva');
    assert.strictEqual(estado.retiredAt, '2026-10-16T12:00:00.000Z');
    assert.strictEqual(estado.retireReason, 'obsoleta');
});

test('#391: una fuente retirada no vuelve a citarse en la respuesta', () => {
    const materiales = [
        { materialId: 'mat-vieja', retirementState: 'retirada' },
        { materialId: 'mat-nueva' },
        { materialId: 'mat-biblio', priority: 'secondary' },
    ];
    const { retiredIds, activeIds } = partitionMaterialsByRetirement(materiales);
    assert.deepStrictEqual([...retiredIds], ['mat-vieja']);
    assert.deepStrictEqual([...activeIds].sort(), ['mat-biblio', 'mat-nueva']);

    const matches = [
        { score: 0.9, metadata: { materialId: 'mat-vieja', sourceFilename: 'guia-2020.txt' } },
        { score: 0.8, metadata: { materialId: 'mat-nueva', sourceFilename: 'guia-2026.txt' } },
    ];
    const filtrados = excludeRetiredMatches(matches, retiredIds);
    assert.strictEqual(filtrados.length, 1);
    assert.strictEqual(filtrados[0].metadata.materialId, 'mat-nueva');
});

test('#391: un match de un material desconocido no se descarta', () => {
    const matches = [{ score: 0.5, metadata: { materialId: 'mat-desconocido' } }, { metadata: {} }];
    assert.strictEqual(excludeRetiredMatches(matches, new Set(['mat-vieja'])).length, 2);
    assert.strictEqual(excludeRetiredMatches(matches, new Set()).length, 2);
});

test('#391: el historial guardado como JSON en la tabla se lee completo', () => {
    const crudo = '[{"action":"retirar","from":"activa","to":"retirada","by":"prof01@uade.edu.ar","at":"2026-10-16T12:00:00.000Z","reason":"obsoleta"}]';
    assert.strictEqual(parseRetirementHistory(crudo).length, 1);
    assert.strictEqual(parseRetirementHistory('no-json').length, 0);
    assert.deepStrictEqual(parseRetirementHistory(undefined), []);

    const estado = resolveMaterialRetirement({ retirementState: 'retirada', retirementHistory: crudo });
    assert.strictEqual(estado.by, 'prof01@uade.edu.ar');
    assert.strictEqual(estado.reason, 'obsoleta');
});
