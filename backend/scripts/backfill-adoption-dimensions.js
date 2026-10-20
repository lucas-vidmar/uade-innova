#!/usr/bin/env node

/**
 * backfill-adoption-dimensions.js — Completa sede y carrera en matrículas y
 * perfiles (#491 / UJ-43, capacidad DI-01).
 *
 * Contexto: el modelo no tenía sede en ninguna parte y la carrera sólo existía
 * en el catálogo de unidades (`subjects[].track`). La lectura de adopción
 * desagregada necesita las dos dimensiones por persona; este script completa lo
 * que falta en los datos que ya existen, sin inventar valores.
 *
 * Reglas:
 *  - Sólo toca matrículas de rol student con status active (la cohorte de la
 *    lectura). Docentes, dirección y administración no se modifican.
 *  - Merge, no Replace: conserva rol, estado, fecha de alta y cualquier otro
 *    campo de la fila.
 *  - Nunca pisa un valor declarado; si el mapa propuesto difiere, lo informa
 *    como conflicto y no escribe.
 *  - La sede no se deriva de la unidad (una unidad puede dictarse en varias
 *    sedes): sale de --campus-map o del perfil. La carrera sí: matrícula →
 *    --track-map → perfil → track de la unidad.
 *  - Sin fuente no escribe: esa persona queda en el corte «sin declarar» de la
 *    lectura (hueco declarado, nunca rellenado).
 *  - Idempotente: correrlo dos veces no produce cambios la segunda vez.
 *
 * Uso:
 *   node backend/scripts/backfill-adoption-dimensions.js                      # dry-run (default)
 *   node backend/scripts/backfill-adoption-dimensions.js --apply              # aplica
 *   node backend/scripts/backfill-adoption-dimensions.js --apply --verify     # aplica y verifica la lectura
 *   node backend/scripts/backfill-adoption-dimensions.js --campus-map sedes.json --report salida.json
 *
 * --campus-map / --track-map: JSON con {"userId": "valor"} o
 *   {"subjectId:userId": "valor"}. El mapa de sedes es el único camino para
 *   declarar una sede real (registro del alumno / SGA): el script no la adivina.
 *
 * Variables de entorno (las mismas que seed-enrollments.js):
 *   AZURE_STORAGE_ACCOUNT_NAME + AZURE_STORAGE_ACCESS_KEY
 *   o AZURE_STORAGE_CONNECTION_STRING (UseDevelopmentStorage=true para Azurite)
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { runAdoptionBackfill, planAdoptionBackfill } from '../src/services/adoption-backfill.js';
import { buildAdoptionReading } from '../src/services/adoption-dimensions.js';
import { loadJson } from '../src/services/storage.js';
import {
  listAllEnrollments,
  listProfileDimensions,
  patchEnrollmentDimensions,
  patchProfileDimensions,
} from '../src/services/state-store.js';

function parseArgs(argv = process.argv.slice(2)) {
  const valueOf = (flag) => {
    const index = argv.indexOf(flag);
    if (index < 0) return null;
    return argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : null;
  };
  return {
    apply: argv.includes('--apply'),
    verify: argv.includes('--verify'),
    help: argv.includes('--help') || argv.includes('-h'),
    campusMapPath: valueOf('--campus-map'),
    trackMapPath: valueOf('--track-map'),
    reportPath: valueOf('--report'),
  };
}

function readMap(path) {
  if (!path) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    throw new Error(`No pude leer el mapa ${path}: ${err.message}`);
  }
}

function buildStores() {
  return {
    listEnrollments: () => listAllEnrollments(),
    listProfiles: () => listProfileDimensions(),
    loadSubjects: async () => ((await loadJson('classes-config', 'subjects.json')) || []),
    patchEnrollment: (patch) => patchEnrollmentDimensions(patch),
    patchProfile: (patch) => patchProfileDimensions(patch),
  };
}

function summarizeReading(reading) {
  return {
    criterio: reading.criteria,
    dimensiones: Object.fromEntries(
      Object.entries(reading.dimensions).map(([name, dimension]) => [name, {
        total: dimension.total,
        cortes: dimension.rows.map((row) => `${row.label}=${row.cohort}`),
      }]),
    ),
    integridad: reading.integrity,
    huecos: reading.gaps.map((gap) => `${gap.reason}: ${gap.detail}`),
  };
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    console.log('Uso: node backend/scripts/backfill-adoption-dimensions.js [--apply] [--verify] [--campus-map file.json] [--track-map file.json] [--report salida.json]');
    return 0;
  }

  const campusMap = readMap(args.campusMapPath);
  const trackMap = readMap(args.trackMapPath);
  const stores = buildStores();

  const result = await runAdoptionBackfill({ stores, apply: args.apply, campusMap, trackMap });

  const output = {
    aplicado: result.applied,
    generado: result.generatedAt,
    cohorte: result.plan.cohort,
    omitidas: result.plan.skipped,
    sinDeclarar: result.plan.unassigned,
    resumen: result.plan.summary,
    conflictos: result.plan.conflicts,
    escrituras: result.written || null,
    parches: args.apply ? null : result.plan,
  };

  if (args.verify) {
    // Se relee el estado final con el mismo plan (debe quedar vacío si es
    // idempotente) y se arma la lectura para comprobar que nadie quedó huérfana.
    const [enrollments, profiles, subjects] = await Promise.all([
      stores.listEnrollments(),
      stores.listProfiles(),
      stores.loadSubjects(),
    ]);
    const after = planAdoptionBackfill({ enrollments, profiles, subjects, campusMap, trackMap });
    const reading = buildAdoptionReading({ subjects, enrollments, profiles, activeUserIdsBySubject: {} });
    output.verificacion = {
      parchesRestantes: after.summary,
      lectura: summarizeReading(reading),
    };
  }

  const json = JSON.stringify(output, null, 2);
  console.log(json);
  if (args.reportPath) writeFileSync(args.reportPath, json + '\n', 'utf8');
  return 0;
}

const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`[backfill-adoption-dimensions] ${err.message}`);
      process.exit(1);
    });
}
