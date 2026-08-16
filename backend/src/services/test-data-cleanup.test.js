import { test } from 'node:test';
import assert from 'node:assert';
import {
    PILOT_SUBJECT_IDS,
    TEST_SUBJECT_IDS,
    TEST_USER_ID_PREFIX,
    isTestSubjectId,
    isTestUser,
    isTestDeadline,
    isTestConversation,
    findZeroMarkers,
    isZeroOnlyTimeline,
    hasTestSnippet,
    isTestMaterial,
    isTestClass,
    isTestEnrollment,
    isTestProfile,
    isTestProcessedPayload,
    isTestBlobName,
    classMaterialBlobBelongsToTest,
    findTestArtifacts,
    runCleanup,
    applyCleanupPlan,
    verifyCleanup,
    summarizePlan,
    CONTAINERS,
} from './test-data-cleanup.js';

// ─── Helpers de fixture ───────────────────────────────────────────────────

function createFakeStores({ data = {}, spies = {} } = {}) {
    const calls = { mutations: [] };
    const record = (name, ...args) => calls.mutations.push({ name, args });

    const stores = {
        listBlobNames: async (container) => data.blobNames?.[container] || [],
        loadDeadlines: async (subjectId) => (data.deadlines?.[subjectId] || []),
        loadTimeline: async (classId) => data.timelines?.[classId] || null,
        loadProcessed: async (blobName) => data.processed?.[blobName] || null,
        loadSubjectsConfig: async () => data.subjectsConfig || null,
        listConversations: async () => data.conversations || [],
        listMaterials: async () => data.materials || [],
        listClasses: async () => data.classes || [],
        listEnrollments: async () => data.enrollments || [],
        listUserProfiles: async () => data.profiles || [],
        saveDeadlines: async (subjectId, deadlines) => { record('saveDeadlines', subjectId, deadlines); },
        saveTimeline: async (classId, timeline) => { record('saveTimeline', classId, timeline); },
        saveSubjectsConfig: async (subjects) => { record('saveSubjectsConfig', subjects); },
        deleteBlob: async (container, blobName) => { record('deleteBlob', container, blobName); },
        deleteConversation: async (userId, conversationId) => { record('deleteConversation', userId, conversationId); },
        deleteMaterial: async (subjectId, materialId) => { record('deleteMaterial', subjectId, materialId); },
        deleteClassesBySubject: async (subjectId) => { record('deleteClassesBySubject', subjectId); },
        deleteEnrollment: async (subjectId, userId) => { record('deleteEnrollment', subjectId, userId); },
        deleteUserProfile: async (userId) => { record('deleteUserProfile', userId); },
        deletePineconeVectorsBySubjectIds: async (subjectIds) => { record('deletePineconeVectorsBySubjectIds', subjectIds); },
        getPineconeStats: async () => ({ totalVectorCount: 0 }),
    };

    for (const [name, fn] of Object.entries(spies)) {
        if (typeof stores[name] === 'function') stores[name] = fn;
    }
    return { stores, calls };
}

const TEST_ARTIFACT_DATA = {
    blobNames: {
        [CONTAINERS.deadlines]: ['arq-software-2026.json'],
        [CONTAINERS.classTimelines]: ['class-01.json'],
        [CONTAINERS.classMaterials]: ['dasi-1c2023/TRABAJO PRÁCTICO FINAL DASI2023.docx'],
        [CONTAINERS.processed]: ['processed-test-01.json'],
    },
    deadlines: {
        'arq-software-2026': [
            { id: 'd-ok', title: 'TP1: Diagrama de Arquitectura C4', dueDate: '2026-06-23' },
            { id: 'd-test', title: 'Test deadlinr', dueDate: '2026-07-02' },
        ],
    },
    timelines: {
        'class-01': {
            classId: 'class-01',
            subjectId: 'arq-software-2026',
            markers: [
                { id: 'mk-0', sectionId: 'sec-0', startSecond: 0, label: 'Pregunta' },
                { id: 'mk-600', sectionId: 'sec-1', startSecond: 600, label: 'Otro' },
            ],
            sections: [],
        },
    },
    processed: {
        'processed-test-01.json': {
            materialId: 'm-test',
            subjectId: 'dasi-1c2023',
            filename: 'DASI Cronograma dia Jueves_1C2023_ejemplo.docx',
            extractedText: 'trigger check',
        },
    },
    conversations: [
        { userId: 'alu-001', conversationId: 'c-ok', subjectId: 'arq-software-2026', firstQuestion: '¿Qué es la arquitectura hexagonal?' },
        { userId: 'alu-001', conversationId: 'c-test', subjectId: 'arq-software-2026', firstQuestion: 'Que es un sistema?' },
        { userId: 'alu-002', conversationId: 'c-dasi', subjectId: 'dasi-1c2023', firstQuestion: 'Otra pregunta' },
    ],
    materials: [
        { subjectId: 'arq-software-2026', materialId: 'm-01', filename: 'clase1_transcripcion.txt' },
        { subjectId: 'dasi-1c2023', materialId: 'm-dasi', filename: 'TRABAJO PRÁCTICO FINAL DASI2023.docx' },
    ],
    classes: [
        { subjectId: 'arq-software-2026', id: 'class-01' },
        { subjectId: 'matematica-2026', id: 'mat-01' },
    ],
    enrollments: [
        { subjectId: 'arq-software-2026', userId: 'alu-001', role: 'student' },
        { subjectId: 'dasi-1c2023', userId: 'alu-001', role: 'student' },
        { subjectId: 'arq-software-2026', userId: 'test-alu-001', role: 'student' },
    ],
    profiles: [
        { rowKey: 'alu-001', displayName: 'Lucas Vidmar' },
        { rowKey: 'test-alu-001', displayName: 'Ana García' },
    ],
    subjectsConfig: [
        { id: 'arq-software-2026', name: 'Arquitectura de Software 2026' },
        { id: 'dasi-1c2023', name: 'DASI - Análisis de Sistemas' },
    ],
};

// ─── Detectores puros ─────────────────────────────────────────────────────

test('isTestSubjectId reconoce solo materias de prueba', () => {
    for (const subjectId of TEST_SUBJECT_IDS) assert.ok(isTestSubjectId(subjectId));
    assert.ok(!isTestSubjectId('arq-software-2026'));
    assert.ok(!isTestSubjectId('diseno-sistemas-2026'));
    assert.ok(!isTestSubjectId(null));
});

test('isTestUser reconoce perfiles test-alu-*', () => {
    assert.ok(isTestUser('test-alu-001'));
    assert.ok(isTestUser(TEST_USER_ID_PREFIX));
    assert.ok(!isTestUser('alu-001'));
    assert.ok(!isTestUser(''));
});

test('isTestDeadline detecta "Test deadlinr"', () => {
    assert.ok(isTestDeadline({ title: 'Test deadlinr' }));
    assert.ok(isTestDeadline({ title: 'TEST DEADLINR' }));
    assert.ok(!isTestDeadline({ title: 'TP1: Diagrama de Arquitectura C4' }));
});

test('isTestConversation detecta "Que es un sistema?" (igualdad exacta) y materias de prueba', () => {
  assert.ok(isTestConversation({ subjectId: 'arq-software-2026', firstQuestion: 'Que es un sistema?' }));
  assert.ok(isTestConversation({ subjectId: 'arq-software-2026', firstQuestion: '¿Qué es un sistema?' }));
  assert.ok(isTestConversation({ subjectId: 'dasi-1c2023', firstQuestion: 'Otra' }));
  assert.ok(isTestConversation({ userId: 'test-alu-001', subjectId: 'arq-software-2026', firstQuestion: 'Pregunta benigna' }));
  // Preguntas legítimas más largas NO deben borrarse (no substring).
  assert.ok(!isTestConversation({ subjectId: 'arq-software-2026', firstQuestion: '¿Qué es un sistema distribuido?' }));
  assert.ok(!isTestConversation({ subjectId: 'arq-software-2026', firstQuestion: '¿Qué es la arquitectura hexagonal?' }));
});

test('findZeroMarkers aísla solo marcadores con startSecond explícito === 0', () => {
  const timeline = {
    markers: [
      { id: 'a', startSecond: 0 },
      { id: 'b', startSecond: 600 },
      { id: 'c' }, // sin timestamp → NO es un 0s
      { id: 'd', startSecond: null },
    ],
  };
  const zero = findZeroMarkers(timeline);
  assert.deepStrictEqual(zero.map((m) => m.id), ['a']);
});

test('isZeroOnlyTimeline detecta timelines completamente en 0s', () => {
    assert.ok(isZeroOnlyTimeline({ markers: [{ startSecond: 0 }, { startSecond: 0 }] }));
    assert.ok(!isZeroOnlyTimeline({ markers: [{ startSecond: 0 }, { startSecond: 120 }] }));
    assert.ok(!isZeroOnlyTimeline({ markers: [] }));
});

test('hasTestSnippet detecta "trigger check" y "retry old doc"', () => {
  assert.ok(hasTestSnippet({ markers: [{ label: 'trigger check' }], sections: [] }));
  assert.ok(hasTestSnippet({ markers: [], sections: [{ text: 'Se repitió retry old doc' }] }));
  assert.ok(!hasTestSnippet({ markers: [{ label: 'Arquitectura hexagonal' }], sections: [] }));
});

test('hasTestSnippet detecta archivos DASI/Econometría en sourceFilename del timeline', () => {
  const timeline = {
    markers: [
      {
        id: 'mk-1',
        sectionId: 'sec-1',
        startSecond: 120,
        label: 'Sección normal',
        sourceFilename: 'DASI Cronograma dia Jueves_1C2023_ejemplo.docx',
      },
    ],
    sections: [],
  };
  assert.ok(hasTestSnippet(timeline));
  assert.ok(!hasTestSnippet({ markers: [{ label: 'X', sourceFilename: 'clase1_transcripcion.txt' }], sections: [] }));
});

test('hasTestSnippet: timeline piloto cuyo label/section menciona DASI/Econometría NO se marca (guard piloto)', () => {
  const pilotTimeline = {
    subjectId: 'arq-software-2026',
    markers: [
      { id: 'mk-1', startSecond: 600, label: 'Econometría aplicada al caso' },
      { id: 'mk-2', startSecond: 1200, label: 'Análisis DASI del material' },
    ],
    sections: [{ text: 'Discusión sobre econometría y modelos DASI' }],
  };
  assert.ok(!hasTestSnippet(pilotTimeline), 'contenido DASI/econometría legítimo de materia piloto no se marca');

  // Subject de test con el mismo contenido SÍ se marca por DASI.
  assert.ok(hasTestSnippet({ ...pilotTimeline, subjectId: 'dasi-1c2023' }));
});

test('hasTestSnippet: snippet de test aplica incluso en materia piloto', () => {
  const pilotTimeline = {
    subjectId: 'arq-software-2026',
    markers: [{ id: 'mk-1', startSecond: 600, label: 'trigger check' }],
    sections: [{ text: 'Se repitió retry old doc' }],
  };
  assert.ok(hasTestSnippet(pilotTimeline));
});

test('verifyCleanup no falla con timeline piloto cuyo label menciona DASI/Econometría', async () => {
  const data = {
    blobNames: { [CONTAINERS.classTimelines]: ['class-01.json'] },
    timelines: {
      'class-01': {
        classId: 'class-01',
        subjectId: 'arq-software-2026',
        markers: [{ id: 'mk-1', startSecond: 600, label: 'Econometría DASI' }],
        sections: [],
      },
    },
  };
  const { stores } = createFakeStores({ data });

  const plan = await findTestArtifacts(stores);
  assert.strictEqual(plan.timelines.length, 0, 'el timeline piloto con DASI en label no debe reportarse');

  const result = await verifyCleanup(stores);
  assert.strictEqual(result.ok, true);
  assert.ok(!result.remaining.includes('timelines'));
});

test('isTestMaterial detecta subject test; contenido piloto con filename DASI NO se borra', () => {
  assert.ok(isTestMaterial({ subjectId: 'dasi-1c2023', materialId: 'm', filename: 'x.txt' }));
  assert.ok(isTestMaterial({ subjectId: 'matematica-2026', materialId: 'm', filename: 'DASI Cronograma dia Jueves_1C2023_ejemplo.docx' }));
  assert.ok(isTestMaterial({ subjectId: 'matematica-2026', materialId: 'm', filename: 'TRABAJO PRÁCTICO FINAL DASI2023.docx' }));
  // Materia piloto: filename DASI/econometría NO es motivo de borrado (guard).
  assert.ok(!isTestMaterial({ subjectId: 'arq-software-2026', materialId: 'm', filename: 'DASI Cronograma dia Jueves_1C2023_ejemplo.docx' }));
  assert.ok(!isTestMaterial({ subjectId: 'arq-software-2026', materialId: 'm-01', filename: 'clase1_transcripcion.txt' }));
});

test('isTestClass / isTestEnrollment / isTestProfile', () => {
  assert.ok(isTestClass({ subjectId: 'matematica-2026', id: 'mat-01' }));
  assert.ok(!isTestClass({ subjectId: 'arq-software-2026', id: 'class-01' }));
  assert.ok(isTestEnrollment({ subjectId: 'dasi-1c2023', userId: 'alu-001' }));
  assert.ok(isTestEnrollment({ subjectId: 'arq-software-2026', userId: 'test-alu-001' }));
  // Rows con claves invertidas (seed legacy): {subjectId:'test-alu-00X', userId:'<subject>'}.
  assert.ok(isTestEnrollment({ subjectId: 'test-alu-001', userId: 'arq-software-2026' }));
  assert.ok(!isTestEnrollment({ subjectId: 'arq-software-2026', userId: 'alu-001' }));
  assert.ok(!isTestEnrollment({ subjectId: 'diseno-sistemas-2026', userId: 'alu-001' }));
  assert.ok(isTestProfile({ rowKey: 'test-alu-005' }));
  assert.ok(!isTestProfile({ rowKey: 'alu-001' }));
});

test('isTestProcessedPayload y isTestBlobName detectan contenido DASI/test', () => {
  assert.ok(isTestProcessedPayload({ subjectId: 'dasi-1c2023', extractedText: '' }));
  assert.ok(isTestProcessedPayload({ subjectId: 'matematica-2026', filename: 'TRABAJO PRÁCTICO FINAL DASI2023.docx' }));
  assert.ok(isTestProcessedPayload({ subjectId: 'arq-software-2026', extractedText: 'probando trigger check' }));
  // Materia piloto: filename DASI/econometría NO es motivo de borrado (guard).
  assert.ok(!isTestProcessedPayload({ subjectId: 'arq-software-2026', filename: 'TRABAJO PRÁCTICO FINAL DASI2023.docx' }));
  assert.ok(!isTestProcessedPayload({ subjectId: 'arq-software-2026', filename: 'clase1.txt', extractedText: 'clase normal' }));
  assert.ok(isTestBlobName('class-01/DASI Cronograma dia Jueves_1C2023_ejemplo.docx'));
  assert.ok(isTestBlobName('dasi-1c2023/algún-archivo'));
  assert.ok(!isTestBlobName('class-01/m-01'));
});

test('classMaterialBlobBelongsToTest exige contexto de subject test', () => {
  const ctx = {
    testMaterialFilenames: new Set(['dasi cronograma dia jueves_1c2023_ejemplo.docx']),
    testClassIds: new Set(['class-05']),
  };
  // Path del pipeline: {subjectId}/{materialId}{ext} con subject test.
  assert.ok(classMaterialBlobBelongsToTest('dasi-1c2023/abc-123-uuid.docx', ctx));
  // Legacy: {classId}/{filename} con classId de una clase test.
  assert.ok(classMaterialBlobBelongsToTest('class-05/DASI Cronograma dia Jueves_1C2023_ejemplo.docx', ctx));
  // Filename de un material de test conocido.
  assert.ok(classMaterialBlobBelongsToTest('class-01/DASI Cronograma dia Jueves_1C2023_ejemplo.docx', ctx));
  // Sin contexto de subject (blob legacy de clase piloto) → NO se borra.
  assert.ok(!classMaterialBlobBelongsToTest('class-01/DASI cronograma preliminar.docx', ctx));
  // Sin patrón DASI/test → nunca.
  assert.ok(!classMaterialBlobBelongsToTest('arq-software-2026/m-01.txt', ctx));
});

test('findTestArtifacts: blobs class-materials solo se enumeran con contexto de subject test', async () => {
  const data = {
    blobNames: {
      [CONTAINERS.classMaterials]: [
        'dasi-1c2023/abc-123-uuid.docx',                                // pipeline subject test → sí
        'class-05/DASI Cronograma dia Jueves_1C2023_ejemplo.docx',      // legacy classId test → sí
        'class-01/DASI cronograma preliminar.docx',                     // clase piloto, filename NO test → NO
        'arq-software-2026/m-01.txt',                                   // piloto normal → NO
      ],
    },
    materials: [
      { subjectId: 'dasi-1c2023', materialId: 'm-dasi', filename: 'DASI Cronograma dia Jueves_1C2023_ejemplo.docx' },
      { subjectId: 'arq-software-2026', materialId: 'm-01', filename: 'clase1_transcripcion.txt' },
    ],
    classes: [
      { subjectId: 'arq-software-2026', id: 'class-01' },
      { subjectId: 'dasi-1c2023', id: 'class-05' },
    ],
  };
  const { stores } = createFakeStores({ data });

  const plan = await findTestArtifacts(stores);

  assert.deepStrictEqual(
    plan.classMaterialBlobs.map((b) => b.blobName),
    ['dasi-1c2023/abc-123-uuid.docx', 'class-05/DASI Cronograma dia Jueves_1C2023_ejemplo.docx'],
    'solo deben enumerarse blobs con contexto de subject test',
  );
});

test('applyCleanupPlan: timeline de subject test con classId compartido con clase piloto NO se borra entero', async () => {
  const data = {
    blobNames: { [CONTAINERS.classTimelines]: ['class-01.json'] },
    timelines: {
      'class-01': {
        classId: 'class-01',
        subjectId: 'dasi-1c2023',
        markers: [
          { id: 'mk-0', startSecond: 0, label: 'X' },
          { id: 'mk-600', startSecond: 600, label: 'OK' },
        ],
        sections: [],
      },
    },
    classes: [{ subjectId: 'arq-software-2026', id: 'class-01' }],
  };
  const { stores, calls } = createFakeStores({ data });

  const result = await applyCleanupPlan(stores, await findTestArtifacts(stores), { skipPinecone: true });

  assert.ok(
    !calls.mutations.some((c) => c.name === 'deleteBlob' && c.args[0] === CONTAINERS.classTimelines),
    'no debe borrar el blob compartido con la clase piloto',
  );
  const saveCalls = calls.mutations.filter((c) => c.name === 'saveTimeline');
  assert.ok(saveCalls.length >= 1, 'debe re-guardar el timeline (strip parcial) preservando la clase piloto');
  const saved = saveCalls[saveCalls.length - 1].args[1];
  assert.deepStrictEqual(saved.markers.map((m) => m.id), ['mk-600'], 'solo se eliminan los markers ofensivos');
});

// ─── Enumeración / dry-run / live ─────────────────────────────────────────

test('findTestArtifacts enumera todas las categorías de artefactos', async () => {
    const { stores } = createFakeStores({ data: TEST_ARTIFACT_DATA });
    const plan = await findTestArtifacts(stores);

    assert.strictEqual(plan.deadlines.length, 1);
    assert.strictEqual(plan.deadlines[0].title, 'Test deadlinr');

    assert.strictEqual(plan.conversations.length, 2);
    assert.ok(plan.conversations.some((c) => c.conversationId === 'c-test'));
    assert.ok(plan.conversations.some((c) => c.conversationId === 'c-dasi'));

    assert.strictEqual(plan.timelines.length, 1);
    assert.strictEqual(plan.timelines[0].zeroMarkers, 1);

    assert.strictEqual(plan.materials.length, 1);
    assert.strictEqual(plan.materials[0].materialId, 'm-dasi');

    assert.strictEqual(plan.classes.length, 1);
    assert.strictEqual(plan.classes[0].subjectId, 'matematica-2026');

    assert.strictEqual(plan.enrollments.length, 2);
    assert.strictEqual(plan.profiles.length, 1);
    assert.strictEqual(plan.classMaterialBlobs.length, 1);
    assert.strictEqual(plan.processedBlobs.length, 1);
    assert.strictEqual(plan.subjectsConfig.length, 1);
    assert.deepStrictEqual(plan.pineconeSubjectIds, TEST_SUBJECT_IDS);

    const summary = summarizePlan(plan);
    assert.strictEqual(summary.deadlines, 1);
    assert.strictEqual(summary.conversations, 2);
    assert.strictEqual(summary.timelineMarkers, 1);
});

test('runCleanup en dry-run reporta y NO muta el storage', async () => {
    const { stores, calls } = createFakeStores({ data: TEST_ARTIFACT_DATA });

    const result = await runCleanup(stores, { dryRun: true });

    assert.strictEqual(result.dryRun, true);
    assert.strictEqual(result.deleted, null);
    assert.ok(result.summary.deadlines >= 1);
    assert.strictEqual(calls.mutations.length, 0, 'dry-run no debe llamar a ninguna operación de borrado');
});

test('runCleanup en live aplica las eliminaciones correctas', async () => {
    const { stores, calls } = createFakeStores({ data: TEST_ARTIFACT_DATA });

    const result = await runCleanup(stores, { dryRun: false, skipPinecone: false });

    assert.strictEqual(result.dryRun, false);
    assert.ok(result.deleted);
    assert.deepStrictEqual(result.failures, []);
    const names = calls.mutations.map((c) => c.name);

    assert.ok(names.includes('deleteBlob'), 'blobs test deben borrarse');
    assert.ok(names.includes('deleteConversation'));
    assert.ok(names.includes('deleteMaterial'));
    assert.ok(names.includes('deleteClassesBySubject'));
    assert.ok(names.includes('deleteEnrollment'));
    assert.ok(names.includes('deleteUserProfile'));
    assert.ok(names.includes('deletePineconeVectorsBySubjectIds'), 'con skipPinecone:false se delega el borrado de vectores');
    assert.ok(names.includes('saveSubjectsConfig'), 'subjects.json debe reescribirse sin subjects test');
});

test('runCleanup por defecto NO toca Pinecone (handoff Story 10.17)', async () => {
    const { stores, calls } = createFakeStores({ data: TEST_ARTIFACT_DATA });

    await runCleanup(stores, { dryRun: false });

    const names = calls.mutations.map((c) => c.name);
    assert.ok(!names.includes('deletePineconeVectorsBySubjectIds'), 'el default debe omitir Pinecone');
});

test('verifyCleanup ok cuando no quedan artefactos', async () => {
    const { stores } = createFakeStores({
        data: {
            conversations: [{ userId: 'alu-001', conversationId: 'c-ok', subjectId: 'arq-software-2026', firstQuestion: '¿Qué es la arquitectura hexagonal?' }],
            materials: [{ subjectId: 'arq-software-2026', materialId: 'm-01', filename: 'clase1_transcripcion.txt' }],
            profiles: [{ rowKey: 'alu-001', displayName: 'Lucas' }],
        },
    });
    const result = await verifyCleanup(stores);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.remaining, []);
});

test('verifyCleanup detecta artefactos restantes', async () => {
    const { stores } = createFakeStores({ data: TEST_ARTIFACT_DATA });
    const result = await verifyCleanup(stores);
    assert.strictEqual(result.ok, false);
    assert.ok(result.remaining.includes('deadlines'));
    assert.ok(result.remaining.includes('conversations'));
});

test('verifyCleanup con skipPinecone reporta la delegación a Story 10.17', async () => {
    const { stores } = createFakeStores({ data: {} });
    const result = await verifyCleanup(stores, { skipPinecone: true });
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.delegated, ['pinecone']);
});

test('applyCleanupPlan aísla fallos por categoría y continúa con el resto', async () => {
    const { stores, calls } = createFakeStores({ data: TEST_ARTIFACT_DATA });
    // deleteConversation falla; el resto de categorías debe seguir ejecutándose.
    stores.deleteConversation = async () => { throw new Error('boom conversations'); };

    const result = await applyCleanupPlan(stores, await findTestArtifacts(stores), { skipPinecone: true });

    assert.ok(result.failures.some((f) => f.category === 'conversations'), 'debe registrar el fallo de conversaciones');
    assert.ok(calls.mutations.some((c) => c.name === 'deleteMaterial'), 'materials debe continuar tras el fallo');
    assert.ok(calls.mutations.some((c) => c.name === 'deleteUserProfile'), 'profiles debe continuar tras el fallo');
    assert.ok(result.deleted.materials >= 1);
});

test('applyCleanupPlan sobre timeline piloto contaminado: elimina solo los markers ofensivos y guarda', async () => {
    const data = {
        blobNames: { [CONTAINERS.classTimelines]: ['class-01.json'] },
        timelines: {
            'class-01': {
                classId: 'class-01',
                subjectId: 'arq-software-2026',
                markers: [
                    { id: 'mk-bad', sectionId: 'sec-0', startSecond: 600, label: 'trigger check' },
                    { id: 'mk-good', sectionId: 'sec-1', startSecond: 1200, label: 'Actividad guiada' },
                ],
                sections: [],
            },
        },
    };
    const { stores, calls } = createFakeStores({ data });

    const plan = await findTestArtifacts(stores);
    assert.strictEqual(plan.timelines.length, 1, 'el timeline piloto con snippet de test debe detectarse');

    const result = await applyCleanupPlan(stores, plan, { skipPinecone: true });

    const saveCalls = calls.mutations.filter((c) => c.name === 'saveTimeline');
    assert.ok(saveCalls.length >= 1, 'debe re-guardar el timeline (no borrarlo entero)');
    assert.ok(!calls.mutations.some((c) => c.name === 'deleteBlob' && c.args[0] === CONTAINERS.classTimelines), 'no debe borrar el blob entero');
    const saved = saveCalls[0].args[1];
    assert.deepStrictEqual(saved.markers.map((m) => m.id), ['mk-good'], 'solo debe quedar el marker limpio');
    assert.ok(result.deleted.timelines >= 1);
});

test('applyCleanupPlan: timeline zeroOnly de subject test se borra entero', async () => {
    const data = {
        blobNames: { [CONTAINERS.classTimelines]: ['class-01.json'] },
        timelines: {
            'class-01': {
                classId: 'class-01',
                subjectId: 'dasi-1c2023',
                markers: [{ id: 'mk-0', startSecond: 0, label: 'X' }],
                sections: [],
            },
        },
    };
    const { stores, calls } = createFakeStores({ data });

    const result = await applyCleanupPlan(stores, await findTestArtifacts(stores), { skipPinecone: true });

    assert.ok(calls.mutations.some((c) => c.name === 'deleteBlob' && c.args[0] === CONTAINERS.classTimelines));
    assert.ok(result.deleted.timelineBlobs >= 1);
});
