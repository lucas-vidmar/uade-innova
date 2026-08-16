#!/usr/bin/env node
/**
 * backend/scripts/cleanup-test-data.js
 *
 * Story 10.23 (QA-014) — Limpieza y re-siembra de datos de prueba del entorno.
 *
 * Sigue el patrón de `backend/scripts/reindex-vector-classid.js` y su runbook
 * `docs/reindex-vector-classid-migration.md`: dry-run primero, luego live.
 *
 * ## Usage
 *   node backend/scripts/cleanup-test-data.js              # preview (dry-run, sin mutación)
 *   node backend/scripts/cleanup-test-data.js --dry-run    # preview explícito
 *   node backend/scripts/cleanup-test-data.js --live       # aplica eliminaciones (pide confirmación)
 *   node backend/scripts/cleanup-test-data.js --reseed     # limpieza live + reseed piloto + verify
 *   node backend/scripts/cleanup-test-data.js --verify     # verifica que no queden artefactos (QA-014)
 *   node backend/scripts/cleanup-test-data.js --with-pinecone  # también borra vectores de subjects test
 *                                                          # (default: SKIP — handoff a Story 10.17)
 *   node backend/scripts/cleanup-test-data.js --yes        # saltea la confirmación interactiva (CI)
 *   node backend/scripts/cleanup-test-data.js --help       # muestra ayuda
 *
 * ## Required environment variables
 *   AZURE_STORAGE_ACCOUNT_NAME, AZURE_STORAGE_ACCESS_KEY (o CONNECTION_STRING)
 *   PINECONE_HOST, PINECONE_INDEX_NAME, PINECONE_API_KEY (solo con --with-pinecone)
 *
 * ## Safety
 *   - `--live`/`--reseed` piden confirmación interactiva salvo `--yes`.
 *   - `DRY_RUN=true` (o `--dry-run`) fuerza modo preview (fail-closed): aunque
 *     se pase `--live`/`--reseed`, NO se ejecuta ninguna eliminación.
 *   - Se BLOQUEA `--live`/`--reseed` contra un storage piloto/producción
 *     (nombre con `stdashboard` o NODE_ENV=production) salvo
 *     `ALLOW_CLEANUP_PILOT=true` (no recomendado).
 *   - Pinecone NO se toca por defecto: borrar vectores es handoff a Story 10.17.
 *
 * ## Rollback
 *   La limpieza solo elimina datos de prueba (deadlines "Test deadlinr",
 *   conversaciones "Que es un sistema?", timelines en 0s, materias test, perfiles
 *   test-alu-*, blobs DASI/Econometría). No muta subjectId/classId del piloto.
 *   Para restaurar fixtures piloto usá --reseed (backend/scripts/seed-initial-data.js +
 *   backend/scripts/seed-enrollments.js). Ver docs/cleanup-reseed-procedure.md.
 */

import { pathToFileURL } from 'url';
import { fileURLToPath } from 'url';
import path from 'path';
import readline from 'readline';
import { spawnSync } from 'child_process';

import {
    runCleanup,
    verifyCleanup,
    PILOT_SUBJECT_IDS,
    TEST_SUBJECT_IDS,
} from '../src/services/test-data-cleanup.js';
import { loadJson, saveJson, deleteBlob, listBlobs } from '../src/services/storage.js';
import {
    listAllConversations,
    listAllMaterials,
    listAllClasses,
    listAllEnrollments,
    listAllUserProfiles,
    deleteConversation,
    deleteMaterialState,
    deleteClassesBySubject,
    deleteEnrollment,
    deleteUserProfile,
} from '../src/services/state-store.js';
import { deleteVectorsByFilter, getIndexStats } from '../src/services/vector-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Marca de naming del storage del piloto/producción (AGENTS.md §7.3: stdashboard{token}).
const PILOT_STORAGE_MARKER = 'stdashboard';

function printUsage() {
    console.log(`Uso: node backend/scripts/cleanup-test-data.js [opciones]

Opciones:
  --dry-run                 Solo simula la limpieza (sin mutación). Es el default.
  --live                    Aplica las eliminaciones de datos de prueba (pide confirmación).
  --reseed                  Limpieza live + re-siembra de fixtures piloto + verificación.
  --verify                  Verifica que no queden artefactos QA-014 (sin mutación).
  --with-pinecone           También borra vectores Pinecone de subjects test.
                            Default: SKIP (handoff a Story 10.17).
  --skip-pinecone           (explícito) Omite Pinecone — redundante con el default.
  --yes, -y                 Saltea la confirmación interactiva (CI).
  --help, -h                Muestra esta ayuda.

Variables de entorno:
  DRY_RUN=true              Equivalente a --dry-run.
  ALLOW_CLEANUP_PILOT=true  Permite --live/--reseed contra storage piloto/producción
                            (NO recomendado).
`);
}

export function parseArgs(argv = process.argv.slice(2), env = process.env) {
    const dryRunFlag = env.DRY_RUN === 'true' || argv.includes('--dry-run');
    const live = argv.includes('--live');
    const reseed = argv.includes('--reseed');
    const verify = argv.includes('--verify');
    const withPinecone = argv.includes('--with-pinecone');
    const mutating = live || reseed;
    return {
        dryRun: dryRunFlag || !mutating,
        live,
        reseed,
        verify,
        // Pinecone: handoff a Story 10.17. Default = SKIP; solo `--with-pinecone` lo activa.
        withPinecone,
        skipPinecone: argv.includes('--skip-pinecone') || !withPinecone,
        yes: argv.includes('--yes') || argv.includes('-y'),
        help: argv.includes('--help') || argv.includes('-h'),
    };
}

function buildStores() {
    return {
        // enumeración
        listBlobNames: (container) => listBlobs(container),
        loadDeadlines: async (subjectId) => (await loadJson('deadlines', `${subjectId}.json`)) || [],
        loadTimeline: (classId) => loadJson('class-timelines', `${classId}.json`),
        loadProcessed: (blobName) => loadJson('processed', blobName),
        loadSubjectsConfig: () => loadJson('classes-config', 'subjects.json'),
        listConversations: () => listAllConversations(),
        listMaterials: () => listAllMaterials(),
        listClasses: () => listAllClasses(),
        listEnrollments: () => listAllEnrollments(),
        listUserProfiles: () => listAllUserProfiles(),
        // mutación
        saveDeadlines: (subjectId, deadlines) => saveJson('deadlines', `${subjectId}.json`, deadlines),
        saveTimeline: (classId, timeline) => saveJson('class-timelines', `${classId}.json`, timeline),
        saveSubjectsConfig: (subjects) => saveJson('classes-config', 'subjects.json', subjects),
        deleteBlob: (container, blobName) => deleteBlob(container, blobName),
        deleteConversation: (userId, conversationId) => deleteConversation(userId, conversationId),
        deleteMaterial: (subjectId, materialId) => deleteMaterialState(subjectId, materialId),
        deleteClassesBySubject: (subjectId) => deleteClassesBySubject(subjectId),
        deleteEnrollment: (subjectId, userId) => deleteEnrollment(subjectId, userId),
        deleteUserProfile: (userId) => deleteUserProfile(userId),
        // pinecone
        deletePineconeVectorsBySubjectIds: (subjectIds) =>
            deleteVectorsByFilter({ subjectId: { $in: subjectIds } }),
        getPineconeStats: () => getIndexStats(),
    };
}

/**
 * Guard de entorno (Story 10.23): `--live`/`--reseed` se bloquean contra un
 * storage piloto/producción salvo ALLOW_CLEANUP_PILOT=true (lanza un Error que
 * el entrypoint convierte en exit 1). Dry-run/verify solo advierten (no mutan).
 */
function assertStorageTarget(mode) {
    const account = String(process.env.AZURE_STORAGE_ACCOUNT_NAME || '').toLowerCase();
    const isPilotStorage = account.includes(PILOT_STORAGE_MARKER);
    const isProduction = process.env.NODE_ENV === 'production';
    const isMutating = mode === 'live' || mode === 'reseed';

    if ((isPilotStorage || isProduction) && isMutating && process.env.ALLOW_CLEANUP_PILOT !== 'true') {
        console.error('[FATAL] La limpieza LIVE/reseed apunta a un storage de PILOTO/PRODUCCIÓN:');
        console.error(`         Storage detectado: ${process.env.AZURE_STORAGE_ACCOUNT_NAME || '(no definido)'}.`);
        console.error('         Seteá ALLOW_CLEANUP_PILOT=true SOLO si estás seguro (no recomendado).');
        throw new Error('Storage piloto/producción detectado. Se requiere ALLOW_CLEANUP_PILOT=true para --live/--reseed.');
    }

    if ((isPilotStorage || isProduction) && !isMutating) {
        console.warn('[WARN] Storage detectado como PILOTO/PRODUCCIÓN. Este modo es preview/verify (sin mutación).');
    }
}

function printCleanupReport(result) {
    const { summary, dryRun, plan, failures } = result;
    const pineconeCount = Array.isArray(plan?.pineconeSubjectIds) ? plan.pineconeSubjectIds.length : 0;
    console.log('');
    console.log(`=== ${dryRun ? 'PREVIEW (dry-run, sin mutación)' : 'LIMPIEZA APLICADA'} ===`);
    console.log(`Deadlines de prueba:        ${summary.deadlines}`);
    console.log(`Conversaciones de prueba:   ${summary.conversations}`);
    console.log(`Timelines de prueba:        ${summary.timelines} (${summary.timelineMarkers} marcadores en 0s)`);
    console.log(`Materiales de prueba:       ${summary.materials}`);
    console.log(`Clases de prueba:           ${summary.classes}`);
    console.log(`Enrollments de prueba:      ${summary.enrollments}`);
    console.log(`Perfiles de prueba:         ${summary.profiles}`);
    console.log(`Blobs class-materials:      ${summary.classMaterialBlobs}`);
    console.log(`Blobs processed:            ${summary.processedBlobs}`);
    console.log(`Entradas subjects.json:     ${summary.subjectsConfig}`);
    console.log(`Subjects Pinecone (handoff 10.17): ${pineconeCount} (no se borran salvo --with-pinecone)`);

    if (!dryRun && result.deleted) {
        console.log('');
        console.log('=== Resumen de eliminaciones ===');
        for (const [key, value] of Object.entries(result.deleted)) {
            if (value > 0) console.log(`  ${key}: ${value}`);
        }
    }

    // El total de artefactos EXCLUYE Pinecone (handoff a Story 10.17).
    const total = Object.values(summary).reduce((acc, v) => acc + (typeof v === 'number' ? v : 0), 0);
    console.log('');
    if (total === 0) {
        console.log('✅ No se encontraron artefactos de prueba. El entorno está limpio.');
    } else if (dryRun) {
        console.log(`ℹ️  Se encontraron ${total} artefactos. Ejecutá con --live (o --reseed) para limpiar.`);
    } else {
        console.log(`✅ Se eliminaron ${total} artefactos de prueba.`);
    }

    if (!dryRun && Array.isArray(failures) && failures.length > 0) {
        console.log('');
        console.log('❌ Fallos parciales durante la limpieza:');
        for (const failure of failures) {
            console.log(`   - ${failure.category}: ${failure.message}`);
        }
    }
}

function printVerifyReport(result) {
    console.log('');
    console.log('=== Verificación QA-014 (no quedan artefactos de prueba) ===');
    if (result.ok) {
        console.log('✅ OK: no hay deadlines "Test deadlinr", chats "Que es un sistema?",');
        console.log('   timelines en 0s, materias/perfiles test ni contenido DASI/Econometría.');
    } else {
        console.log('❌ Todavía quedan artefactos de prueba:');
        for (const category of result.remaining) {
            console.log(`   - ${category}: ${result.plan[category].length}`);
        }
    }
    if (Array.isArray(result.delegated) && result.delegated.includes('pinecone')) {
        console.log('ℹ️  Verificación de vectores Pinecone delegada a Story 10.17 (QA-002).');
    }
}

/**
 * Confirmación interactiva. En entornos sin TTY (CI, EOF) o ante Ctrl+C,
 * devuelve false (cancelar) en lugar de colgar o fallar.
 */
function confirm(prompt) {
    if (!process.stdin.isTTY) return Promise.resolve(false);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        const done = (answer) => {
            rl.close();
            resolve(Boolean(answer) && (answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes'));
        };
        rl.question(prompt, (answer) => done(answer || ''));
        rl.on('SIGINT', () => done(''));
    });
}

function runReseed() {
    let ok = true;
    for (const script of ['seed-initial-data.js', 'seed-enrollments.js']) {
        const scriptPath = path.join(__dirname, script);
        console.log(`  ▶ node ${scriptPath}`);
        const result = spawnSync(process.execPath, [scriptPath], { stdio: 'inherit', env: process.env });
        if (result.status !== 0) {
            console.error(`  ✗ ${script} falló (status ${result.status})`);
            ok = false;
        }
    }
    return ok;
}

export async function main(options = {}) {
    const args = options.args || parseArgs();
    const stores = options.stores || buildStores();
    // Inyectable para testing (Story 10.23): evita spawn real de seeds.
    const runReseedFn = options.runReseed || runReseed;

    if (args.help) {
        printUsage();
        return { status: 'help' };
    }

    const mode = args.reseed ? 'reseed' : args.verify ? 'verify' : args.live ? 'live' : 'dry-run';
    const dryRun = args.dryRun;

    console.log('=== Cleanup de datos de prueba (Story 10.23 / QA-014) ===');
    console.log(`Modo: ${mode.toUpperCase()}${dryRun ? ' (preview, sin mutación)' : ''}`);
    console.log(`Materias de prueba objetivo: ${TEST_SUBJECT_IDS.join(', ')}`);
    console.log(`Materias piloto: ${PILOT_SUBJECT_IDS.join(', ')}`);
    console.log(`Pinecone: ${args.skipPinecone ? 'SKIP (handoff Story 10.17)' : 'incluido (--with-pinecone)'}`);

    // Guard de entorno: bloquea live/reseed contra storage piloto/producción.
    assertStorageTarget(mode);

    if (mode === 'verify') {
        const result = await verifyCleanup(stores, { skipPinecone: args.skipPinecone });
        printVerifyReport(result);
        return { status: result.ok ? 'ok' : 'artifacts-remaining', ...result };
    }

    // ── Fail-closed: DRY_RUN=true (o --dry-run) fuerza preview ──
    // Aunque el usuario combine DRY_RUN=true con --live/--reseed, NUNCA se
    // ejecutan eliminaciones: se imprime el reporte preview y se sale sin
    // mutar nada. Contrato documentado: DRY_RUN=true ≡ --dry-run.
    if (dryRun) {
        const result = await runCleanup(stores, { dryRun: true, skipPinecone: args.skipPinecone });
        printCleanupReport(result);
        if (mode === 'reseed') {
            console.log('\n[Reseed] (preview) Se re-ejecutarían: seed-initial-data.js + seed-enrollments.js (solo scope piloto).');
        }
        if (mode === 'live' || mode === 'reseed') {
            console.log('\n[DRY_RUN] Fuerza preview: --live/--reseed NO ejecutan mutación mientras DRY_RUN=true.');
        }
        return { status: 'dry-run', ...result };
    }

    // ── Modos mutantes (live / reseed): confirmación salvo --yes ──
    if (!args.yes) {
        const verb = mode === 'reseed' ? 'limpieza LIVE + reseed de fixtures piloto' : 'limpieza LIVE del storage';
        const ok = await confirm(`Estás por MODIFICAR el storage (${verb}). ¿Continuar? (y/N) `);
        if (!ok) {
            console.log('Cancelado.');
            return { status: 'cancelled' };
        }
    }

    const cleanupResult = await runCleanup(stores, { dryRun: false, skipPinecone: args.skipPinecone });
    printCleanupReport(cleanupResult);
    const failed = Array.isArray(cleanupResult.failures) && cleanupResult.failures.length > 0;

    if (mode === 'reseed') {
        if (failed) {
            console.error('\n[Reseed] Cancelado: la limpieza LIVE reportó fallos. Revisá el output.');
            return { status: 'failures' };
        }

        console.log('\n=== Reseed de fixtures piloto ===');
        const seedOk = runReseedFn();
        if (!seedOk) return { status: 'reseed-failed' };

        console.log('\n=== Verificación post-reseed ===');
        const verifyResult = await verifyCleanup(stores, { skipPinecone: args.skipPinecone });
        printVerifyReport(verifyResult);
        return { status: verifyResult.ok ? 'ok' : 'artifacts-remaining', ...verifyResult };
    }

    return { status: failed ? 'failures' : 'done', ...cleanupResult };
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
    main()
        .then((result) => {
            const okStatuses = ['ok', 'done', 'dry-run', 'help'];
            process.exit(okStatuses.includes(result?.status) ? 0 : 1);
        })
        .catch((err) => {
            console.error('[Cleanup] Fatal:', err);
            process.exit(1);
        });
}
