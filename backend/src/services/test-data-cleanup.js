/**
 * services/test-data-cleanup.js — Detección y limpieza de datos de prueba
 * (Story 10.23 / QA-014 "Isolate Stale/Test Pilot Data").
 *
 * Este módulo es intencionalmente "puro": no importa clientes de Azure. Recibe
 * un objeto `stores` (adaptador sobre backend/src/services/storage.js,
 * state-store.js y vector-store.js) para poder testearse con un storage
 * simulado y para que el CLI `backend/scripts/cleanup-test-data.js` inyecte el
 * storage real. Cambios permitidos: etiquetado aditivo (`env`) o eliminación de
 * datos de prueba. NUNCA se muta el subjectId/classId del piloto.
 */

// Materias del piloto aprobadas (AC #1): el único scope visible para pilot users.
export const PILOT_SUBJECT_IDS = ['arq-software-2026', 'diseno-sistemas-2026'];

// Materias de prueba que nunca deben aparecer en el scope del piloto.
export const TEST_SUBJECT_IDS = ['dasi-1c2023', 'matematica-2026', 'ing-datos-2026', 'arq-soft-2026'];

// Prefijo de los perfiles de alumnos de prueba (seed-test-profiles.js).
export const TEST_USER_ID_PREFIX = 'test-alu-';

// Patrones de artefactos de prueba (QA-014).
// NOTA: deliberadamente NO se usa /\btest\b/i para deadlines: un deadline piloto
// legítimo ("Test de práctica") no debe borrarse. `/deadlinr/i` alcanza al
// artefacto "Test deadlinr" (QA-014).
export const TEST_DEADLINE_PATTERNS = [/deadlinr/i];

// La pregunta de test exacta (QA-014: chats duplicados "Que es un sistema?").
// Se compara por IGUALDAD normalizada (sin puntuación), no por substring, para
// no borrar preguntas legítimas ("¿Qué es un sistema distribuido?").
export const TEST_QUESTION_NORMALIZED = 'que es un sistema';

export const TEST_SNIPPET_PATTERNS = [/trigger\s*check/i, /retry\s*old\s*doc/i];
export const DASI_FILE_PATTERNS = [/dasi/i, /econometr[ií]a/i];
export const ZERO_SECOND = 0;

export const CONTAINERS = {
  classMaterials: 'class-materials',
  processed: 'processed',
  classTimelines: 'class-timelines',
  deadlines: 'deadlines',
  classesConfig: 'classes-config',
  subjectsBlob: 'subjects.json',
};

function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function hasTestSnippetText(text = '') {
  return TEST_SNIPPET_PATTERNS.some((pattern) => pattern.test(normalizeText(text)));
}

function hasDasiText(text = '') {
  return DASI_FILE_PATTERNS.some((pattern) => pattern.test(normalizeText(text)));
}

// ─── Detectores (funciones puras) ─────────────────────────────────────────

export function isTestSubjectId(subjectId) {
  return TEST_SUBJECT_IDS.includes(String(subjectId || ''));
}

export function isTestUser(userId) {
  return String(userId || '').startsWith(TEST_USER_ID_PREFIX);
}

/**
 * True si el subjectId pertenece al scope PILOTO aprobado. Se usa para NO
 * marcar contenido DASI/econometría legítimo de materias piloto.
 */
export function subjectIsPilot(subjectId) {
  return PILOT_SUBJECT_IDS.includes(String(subjectId || ''));
}

export function isTestDeadline(deadline = {}) {
  const title = normalizeText(deadline.title);
  return TEST_DEADLINE_PATTERNS.some((pattern) => pattern.test(title));
}

export function isTestConversation(conversation = {}) {
  if (isTestSubjectId(conversation.subjectId)) return true;
  // Conversaciones creadas por usuarios de prueba siempre son de test.
  if (isTestUser(conversation.userId)) return true;
  // Igualdad exacta normalizada (sin puntuación/acentos): "Que es un sistema?"
  // → "que es un sistema". Una pregunta más larga NO se borra.
  const question = normalizeText(conversation.firstQuestion).replace(/[^a-z0-9\s]/g, '').trim();
  return question === TEST_QUESTION_NORMALIZED;
}

function isExplicitZeroStartSecond(marker) {
  return typeof marker?.startSecond === 'number' && marker.startSecond === ZERO_SECOND;
}

/**
 * Marcadores de timeline "clavados" en 0s (QA-014). Solo cuenta un startSecond
 * numérico explícito === 0; un timestamp ausente (undefined/null) NO es un 0s.
 * @returns {Array} markers con startSecond exactamente 0.
 */
export function findZeroMarkers(timeline = {}) {
  const markers = Array.isArray(timeline.markers) ? timeline.markers : [];
  return markers.filter(isExplicitZeroStartSecond);
}

/**
 * Timeline cuyo contenido completo está "clavado" en 0s (sin timestamps reales).
 */
export function isZeroOnlyTimeline(timeline = {}) {
  const markers = Array.isArray(timeline.markers) ? timeline.markers : [];
  return markers.length > 0 && markers.every(isExplicitZeroStartSecond);
}

/**
 * Detecta snippets de prueba (`trigger check`, `retry old doc`) y archivos de
 * test (DASI/Econometría) en markers/secciones de un timeline. Para materias
 * piloto se ignoran los patrones DASI (contenido legítimo que mencione
 * "econometría" no se borra); los snippets de test sí aplican siempre.
 */
export function hasTestSnippet(timeline = {}) {
  const texts = [];
  const markers = Array.isArray(timeline.markers) ? timeline.markers : [];
  const sections = Array.isArray(timeline.sections) ? timeline.sections : [];
  for (const marker of markers) {
    texts.push(marker?.label);
    if (!subjectIsPilot(timeline.subjectId)) texts.push(marker?.sourceFilename);
  }
  for (const section of sections) {
    texts.push(section?.text);
    if (!subjectIsPilot(timeline.subjectId)) texts.push(section?.sourceFilename);
  }
  const joined = normalizeText(texts.filter(Boolean).join(' '));
  if (TEST_SNIPPET_PATTERNS.some((pattern) => pattern.test(joined))) return true;
  return DASI_FILE_PATTERNS.some((pattern) => pattern.test(joined));
}

export function isTestMaterial(material = {}) {
  if (isTestSubjectId(material.subjectId)) return true;
  // Contenido piloto legítimo nunca se marca por filename DASI/econometría.
  if (subjectIsPilot(material.subjectId)) return false;
  return hasDasiText(material.filename);
}

export function isTestClass(classData = {}) {
  return isTestSubjectId(classData.subjectId);
}

/**
 * Detecta enrollments de test considerando AMBAS posibilidades de mapeo:
 * rows correctos ({subjectId, userId}) y rows invertidos que dejan
 * {subjectId:'test-alu-00X', userId:'<subject>'} (claves invertidas del seed
 * legacy). `deleteEnrollment(subjectId, userId)` borra la fila correcta en
 * cada caso.
 */
export function isTestEnrollment(enrollment = {}) {
  return isTestSubjectId(enrollment.subjectId)
    || isTestSubjectId(enrollment.userId)
    || isTestUser(enrollment.userId)
    || isTestUser(enrollment.subjectId);
}

export function isTestProfile(profile = {}) {
  const userId = profile.userId || profile.rowKey || '';
  return isTestUser(userId) || isTestSubjectId(profile.subjectId);
}

/**
 * Detecta blobs de `processed` que corresponden a material de prueba.
 * Para materias piloto no aplican los patrones DASI (solo subject test y
 * snippets de test).
 */
export function isTestProcessedPayload(payload = {}) {
  if (isTestSubjectId(payload.subjectId)) return true;
  const text = normalizeText(payload.extractedText);
  if (TEST_SNIPPET_PATTERNS.some((pattern) => pattern.test(text))) return true;
  if (subjectIsPilot(payload.subjectId)) return false;
  return hasDasiText(payload.filename);
}

/**
 * Detecta blobs de `class-materials` por su nombre de blob (ruta). Los nombres
 * típicos son `{classId}/{materialId}` o `{classId}/{filename}`. Sin contexto
 * de subjectId disponible, se detecta por el nombre del archivo (último
 * segmento de la ruta) y el nombre completo con patrones DASI/econometría.
 */
export function isTestBlobName(blobName) {
  const name = normalizeText(blobName);
  const filenameSegment = name.split('/').pop() || name;
  return hasDasiText(filenameSegment) || hasDasiText(name);
}

/**
 * True si un marker del timeline debe eliminarse durante el strip parcial:
 * label con snippet de test, o (fuera de materias piloto) sourceFilename/label
 * DASI/econometría.
 */
function markerIsOffending(marker = {}, subjectId) {
  if (hasTestSnippetText(marker?.label)) return true;
  if (subjectIsPilot(subjectId)) return false;
  return hasDasiText(marker?.sourceFilename) || hasDasiText(marker?.label);
}

function sectionIsOffending(section = {}, subjectId) {
  if (hasTestSnippetText(section?.text)) return true;
  if (subjectIsPilot(subjectId)) return false;
  return hasDasiText(section?.sourceFilename) || hasDasiText(section?.text);
}

// ─── Enumeración ──────────────────────────────────────────────────────────

/**
 * Enumera todos los artefactos de prueba alcanzables desde el storage.
 * @param {object} stores - Adaptador de storage (ver CLI para el adapter real).
 * @returns {Promise<object>} Plan de limpieza con todas las categorías.
 */
export async function findTestArtifacts(stores) {
  const plan = {
    deadlines: [],          // { blobName, subjectId, deadlineId, title }
    conversations: [],      // { userId, conversationId, subjectId, firstQuestion }
    timelines: [],          // { blobName, classId, subjectId, zeroMarkers, testSubject, hasSnippet, zeroOnly }
    materials: [],          // { subjectId, materialId, filename }
    classes: [],            // { subjectId, classId }
    enrollments: [],        // { subjectId, userId, role }
    profiles: [],           // { userId, displayName }
    classMaterialBlobs: [], // { blobName }
    processedBlobs: [],     // { blobName }
    subjectsConfig: [],     // entradas de subjects.json de materias de prueba
    pineconeSubjectIds: TEST_SUBJECT_IDS.slice(),
  };

  // 1. Deadlines en Blob `deadlines/{subjectId}.json`
  try {
    const deadlineBlobs = await stores.listBlobNames(CONTAINERS.deadlines);
    for (const blobName of deadlineBlobs) {
      const subjectId = blobName.replace(/\.json$/, '');
      const deadlines = await stores.loadDeadlines(subjectId);
      for (const deadline of Array.isArray(deadlines) ? deadlines : []) {
        if (isTestDeadline(deadline)) {
          plan.deadlines.push({ blobName, subjectId, deadlineId: deadline.id, title: deadline.title });
        }
      }
    }
  } catch (err) {
    console.warn(`[Cleanup] No se pudieron enumerar deadlines: ${err.message}`);
  }

  // 2. Conversaciones en Table Storage `Conversations`
  try {
    const conversations = await stores.listConversations();
    for (const conversation of conversations) {
      if (isTestConversation(conversation)) {
        plan.conversations.push({
          userId: conversation.userId,
          conversationId: conversation.conversationId,
          subjectId: conversation.subjectId,
          firstQuestion: conversation.firstQuestion,
        });
      }
    }
  } catch (err) {
    console.warn(`[Cleanup] No se pudieron enumerar conversaciones: ${err.message}`);
  }

  // 3. Timelines en Blob `class-timelines/{classId}.json`
  try {
    const timelineBlobs = await stores.listBlobNames(CONTAINERS.classTimelines);
    for (const blobName of timelineBlobs) {
      const classId = blobName.replace(/\.json$/, '');
      const timeline = await stores.loadTimeline(classId);
      if (!timeline) continue;
      const zeroMarkers = findZeroMarkers(timeline);
      const flags = {
        testSubject: isTestSubjectId(timeline.subjectId),
        hasSnippet: hasTestSnippet(timeline),
        zeroOnly: isZeroOnlyTimeline(timeline),
      };
      if (flags.testSubject || flags.hasSnippet || flags.zeroOnly || zeroMarkers.length > 0) {
        plan.timelines.push({
          blobName,
          classId,
          subjectId: timeline.subjectId,
          zeroMarkers: zeroMarkers.length,
          ...flags,
        });
      }
    }
  } catch (err) {
    console.warn(`[Cleanup] No se pudieron enumerar timelines: ${err.message}`);
  }

  // 4. Tabla `materials`
  try {
    const materials = await stores.listMaterials();
    for (const material of materials) {
      if (isTestMaterial(material)) {
        plan.materials.push({
          subjectId: material.subjectId,
          materialId: material.materialId || material.id,
          filename: material.filename,
        });
      }
    }
  } catch (err) {
    console.warn(`[Cleanup] No se pudieron enumerar materiales: ${err.message}`);
  }

  // 5. Tabla `classes`
  try {
    const classes = await stores.listClasses();
    for (const classData of classes) {
      if (isTestClass(classData)) {
        plan.classes.push({ subjectId: classData.subjectId, classId: classData.id });
      }
    }
  } catch (err) {
    console.warn(`[Cleanup] No se pudieron enumerar clases: ${err.message}`);
  }

  // 6. Tabla `Enrollments`
  try {
    const enrollments = await stores.listEnrollments();
    for (const enrollment of enrollments) {
      if (isTestEnrollment(enrollment)) {
        plan.enrollments.push({ subjectId: enrollment.subjectId, userId: enrollment.userId, role: enrollment.role });
      }
    }
  } catch (err) {
    console.warn(`[Cleanup] No se pudieron enumerar enrollments: ${err.message}`);
  }

  // 7. Tabla `UserProfiles`
  try {
    const profiles = await stores.listUserProfiles();
    for (const profile of profiles) {
      if (isTestProfile(profile)) {
        plan.profiles.push({ userId: profile.userId || profile.rowKey, displayName: profile.displayName || profile.name });
      }
    }
  } catch (err) {
    console.warn(`[Cleanup] No se pudieron enumerar perfiles: ${err.message}`);
  }

  // 8. Blobs `class-materials`
  try {
    const blobNames = await stores.listBlobNames(CONTAINERS.classMaterials);
    for (const blobName of blobNames) {
      if (isTestBlobName(blobName)) {
        plan.classMaterialBlobs.push({ blobName });
      }
    }
  } catch (err) {
    console.warn(`[Cleanup] No se pudieron enumerar class-materials: ${err.message}`);
  }

  // 9. Blobs `processed` (inspección de contenido)
  try {
    const blobNames = await stores.listBlobNames(CONTAINERS.processed);
    for (const blobName of blobNames) {
      const payload = await stores.loadProcessed(blobName);
      if (payload && isTestProcessedPayload(payload)) {
        plan.processedBlobs.push({ blobName });
      }
    }
  } catch (err) {
    console.warn(`[Cleanup] No se pudieron enumerar processed: ${err.message}`);
  }

  // 10. `classes-config/subjects.json`
  try {
    const subjectsConfig = await stores.loadSubjectsConfig();
    if (Array.isArray(subjectsConfig)) {
      for (const subject of subjectsConfig) {
        if (isTestSubjectId(subject.id)) {
          plan.subjectsConfig.push({ subjectId: subject.id, name: subject.name });
        }
      }
    }
  } catch (err) {
    console.warn(`[Cleanup] No se pudo inspeccionar subjects.json: ${err.message}`);
  }

  return plan;
}

/**
 * Resumen de artefactos detectados. Excluye Pinecone del total de artefactos:
 * los vectores se reportan por separado como handoff a Story 10.17.
 */
export function summarizePlan(plan) {
  return {
    deadlines: plan.deadlines.length,
    conversations: plan.conversations.length,
    timelines: plan.timelines.length,
    timelineMarkers: plan.timelines.reduce((acc, t) => acc + (t.zeroMarkers || 0), 0),
    materials: plan.materials.length,
    classes: plan.classes.length,
    enrollments: plan.enrollments.length,
    profiles: plan.profiles.length,
    classMaterialBlobs: plan.classMaterialBlobs.length,
    processedBlobs: plan.processedBlobs.length,
    subjectsConfig: plan.subjectsConfig.length,
  };
}

// ─── Aplicación de la limpieza ────────────────────────────────────────────

/**
 * Ejecuta las eliminaciones del plan sobre el storage real. Cada categoría se
 * aísla en try/catch: un fallo en una categoría no aborta el resto; los errores
 * se acumulan en `failures`.
 * @returns {Promise<{deleted: object, failures: Array<{category, message}>}>}
 */
export async function applyCleanupPlan(stores, plan, { skipPinecone = false } = {}) {
  const deleted = {
    deadlines: 0,
    conversations: 0,
    timelines: 0,
    timelineBlobs: 0,
    materials: 0,
    classes: 0,
    enrollments: 0,
    profiles: 0,
    classMaterialBlobs: 0,
    processedBlobs: 0,
    subjectsConfig: 0,
    pinecone: 0,
  };
  const failures = [];
  const recordFailure = (category, message) => failures.push({ category, message });

  // Deadlines agrupados por blob (reescribimos el JSON o borramos el blob si queda vacío).
  try {
    const deadlinesByBlob = new Map();
    for (const entry of plan.deadlines) {
      if (!deadlinesByBlob.has(entry.blobName)) deadlinesByBlob.set(entry.blobName, []);
      deadlinesByBlob.get(entry.blobName).push(entry);
    }
    for (const [blobName, entries] of deadlinesByBlob) {
      const subjectId = blobName.replace(/\.json$/, '');
      const ids = new Set(entries.map((e) => e.deadlineId));
      const deadlines = await stores.loadDeadlines(subjectId);
      const next = (Array.isArray(deadlines) ? deadlines : []).filter((d) => !ids.has(d.id));
      if (next.length === 0) {
        await stores.deleteBlob(CONTAINERS.deadlines, blobName);
      } else {
        await stores.saveDeadlines(subjectId, next);
      }
      deleted.deadlines += entries.length;
    }
  } catch (err) {
    recordFailure('deadlines', err.message);
  }

  try {
    for (const conversation of plan.conversations) {
      await stores.deleteConversation(conversation.userId, conversation.conversationId);
      deleted.conversations += 1;
    }
  } catch (err) {
    recordFailure('conversations', err.message);
  }

  // Timelines: borrado total solo para subject test / timeline completa en 0s.
  // Para un timeline de subject NO-test contaminado (snippet/marker de test),
  // se eliminan solo los markers/secciones ofensivos y se conserva el resto.
  try {
    for (const timeline of plan.timelines) {
      if (timeline.testSubject || timeline.zeroOnly) {
        await stores.deleteBlob(CONTAINERS.classTimelines, timeline.blobName);
        deleted.timelineBlobs += 1;
        continue;
      }

      const current = await stores.loadTimeline(timeline.classId);
      if (!current) {
        recordFailure('timelines', `timeline ${timeline.classId} no cargable`);
        continue;
      }

      const markersBefore = (Array.isArray(current.markers) ? current.markers : []).length;
      current.markers = (Array.isArray(current.markers) ? current.markers : [])
        .filter((marker) => !isExplicitZeroStartSecond(marker) && !markerIsOffending(marker, timeline.subjectId));
      const removedMarkers = markersBefore - current.markers.length;

      const sectionsBefore = (Array.isArray(current.sections) ? current.sections : []).length;
      current.sections = (Array.isArray(current.sections) ? current.sections : [])
        .filter((section) => !sectionIsOffending(section, timeline.subjectId));
      const removedSections = sectionsBefore - current.sections.length;

      if (current.markers.length === 0 && removedMarkers > 0) {
        // Todos los markers se eliminaron → el timeline quedó vacío.
        await stores.deleteBlob(CONTAINERS.classTimelines, timeline.blobName);
        deleted.timelineBlobs += 1;
      } else {
        await stores.saveTimeline(timeline.classId, current);
        deleted.timelines += removedMarkers + removedSections;
      }
    }
  } catch (err) {
    recordFailure('timelines', err.message);
  }

  try {
    for (const material of plan.materials) {
      await stores.deleteMaterial(material.subjectId, material.materialId);
      deleted.materials += 1;
    }
  } catch (err) {
    recordFailure('materials', err.message);
  }

  try {
    const classSubjects = new Set(plan.classes.map((c) => c.subjectId));
    for (const subjectId of classSubjects) {
      await stores.deleteClassesBySubject(subjectId);
      deleted.classes += plan.classes.filter((c) => c.subjectId === subjectId).length;
    }
  } catch (err) {
    recordFailure('classes', err.message);
  }

  try {
    for (const enrollment of plan.enrollments) {
      await stores.deleteEnrollment(enrollment.subjectId, enrollment.userId);
      deleted.enrollments += 1;
    }
  } catch (err) {
    recordFailure('enrollments', err.message);
  }

  try {
    for (const profile of plan.profiles) {
      await stores.deleteUserProfile(profile.userId);
      deleted.profiles += 1;
    }
  } catch (err) {
    recordFailure('profiles', err.message);
  }

  try {
    for (const blob of plan.classMaterialBlobs) {
      await stores.deleteBlob(CONTAINERS.classMaterials, blob.blobName);
      deleted.classMaterialBlobs += 1;
    }
  } catch (err) {
    recordFailure('classMaterialBlobs', err.message);
  }

  try {
    for (const blob of plan.processedBlobs) {
      await stores.deleteBlob(CONTAINERS.processed, blob.blobName);
      deleted.processedBlobs += 1;
    }
  } catch (err) {
    recordFailure('processedBlobs', err.message);
  }

  try {
    if (plan.subjectsConfig.length > 0) {
      const subjectsConfig = await stores.loadSubjectsConfig();
      if (Array.isArray(subjectsConfig)) {
        const testIds = new Set(plan.subjectsConfig.map((s) => s.subjectId));
        await stores.saveSubjectsConfig(subjectsConfig.filter((s) => !testIds.has(s.id)));
      }
      deleted.subjectsConfig += plan.subjectsConfig.length;
    }
  } catch (err) {
    recordFailure('subjectsConfig', err.message);
  }

  // Pinecone: coordinado con Story 10.17 (QA-002). Handoff explícito; por
  // defecto NO se borra salvo que el CLI pase `--with-pinecone`.
  try {
    if (!skipPinecone && plan.pineconeSubjectIds.length > 0) {
      await stores.deletePineconeVectorsBySubjectIds(plan.pineconeSubjectIds);
      deleted.pinecone += plan.pineconeSubjectIds.length;
    }
  } catch (err) {
    recordFailure('pinecone', err.message);
  }

  return { deleted, failures };
}

/**
 * Orquesta la limpieza completa (detección + aplicación opcional).
 * @param {object} stores
 * @param {object} [options]
 * @param {boolean} [options.dryRun=true] - true = solo preview (sin mutación).
 * @param {boolean} [options.skipPinecone=true] - omite el borrado de vectores.
 */
export async function runCleanup(stores, { dryRun = true, skipPinecone = true } = {}) {
  const plan = await findTestArtifacts(stores);
  const summary = summarizePlan(plan);
  let deleted = null;
  let failures = [];
  if (!dryRun) {
    const result = await applyCleanupPlan(stores, plan, { skipPinecone });
    deleted = result.deleted;
    failures = result.failures;
  }
  return { plan, summary, deleted, failures, dryRun };
}

/**
 * Verifica que no queden artefactos de prueba (QA-014) en el storage.
 * Pinecone se reporta como handoff a Story 10.17; con `skipPinecone` se agrega
 * una nota `delegated` para no dar OK falso.
 */
export async function verifyCleanup(stores, { skipPinecone = false } = {}) {
  const plan = await findTestArtifacts(stores);
  const cleanCategories = [
    'deadlines',
    'conversations',
    'timelines',
    'materials',
    'classes',
    'enrollments',
    'profiles',
    'classMaterialBlobs',
    'processedBlobs',
    'subjectsConfig',
  ];
  const remaining = cleanCategories.filter((category) => plan[category].length > 0);
  const delegated = [];
  if (skipPinecone) delegated.push('pinecone');
  return { ok: remaining.length === 0, remaining, delegated, plan };
}
