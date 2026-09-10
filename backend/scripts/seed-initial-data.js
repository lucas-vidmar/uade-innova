#!/usr/bin/env node

// SEED SCRIPT — Solo para desarrollo/piloto. No ejecutar en producción.

/**
 * seed-initial-data.js — Seed inicial de datos para el dashboard educativo.
 * Inserta: UserProfiles, Enrollments, Subjects, Classes, Materials
 *
 * Story 10.23 (QA-014): las fixtures de PILOTO llevan `env: 'pilot'` (etiqueta
 * aditiva). Ningún subjectId/classId del piloto se muta. `eco-internacional-2026`
 * (no presente en pilot-enrollments.csv) se etiqueta `env: 'dev'`. Las fixtures
 * de TEST viven en seed-test-profiles.js / test-upload-rag.mjs y nunca deben
 * promoverse al scope piloto.
 *
 * Usage:
 *   node scripts/seed-initial-data.js
 *
 * Required env:
 *   AZURE_STORAGE_ACCOUNT_NAME
 *   AZURE_STORAGE_ACCESS_KEY (o AZURE_STORAGE_CONNECTION_STRING)
 */

import { TableClient, AzureNamedKeyCredential } from '@azure/data-tables';
import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';

const ACCOUNT_NAME = process.env.AZURE_STORAGE_ACCOUNT_NAME;
const ACCOUNT_KEY = process.env.AZURE_STORAGE_ACCESS_KEY;
const CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;

const ENROLLMENTS_TABLE = process.env.AZURE_TABLE_ENROLLMENTS || 'Enrollments';
const USER_PROFILES_TABLE = 'UserProfiles';
const CLASSES_TABLE = process.env.AZURE_TABLE_CLASSES || 'classes';
const MATERIALS_TABLE = process.env.AZURE_TABLE_MATERIALS || 'materials';
const CLASSES_CONFIG_CONTAINER = process.env.AZURE_STORAGE_CONTAINER_CLASSES || 'classes-config';

function getTableClient(tableName) {
  if (CONNECTION_STRING === 'UseDevelopmentStorage=true' || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development') {
    if (CONNECTION_STRING) {
      return TableClient.fromConnectionString(CONNECTION_STRING, tableName);
    }
    return new TableClient(`http://127.0.0.1:10002/${ACCOUNT_NAME || 'devstoreaccount1'}`, tableName);
  }
  if (!ACCOUNT_NAME || !ACCOUNT_KEY) {
    throw new Error('AZURE_STORAGE_ACCOUNT_NAME and AZURE_STORAGE_ACCESS_KEY required (or AZURE_STORAGE_CONNECTION_STRING)');
  }
  return new TableClient(
    `https://${ACCOUNT_NAME}.table.core.windows.net`,
    tableName,
    new AzureNamedKeyCredential(ACCOUNT_NAME, ACCOUNT_KEY)
  );
}

function getBlobContainerClient() {
  if (!ACCOUNT_NAME) throw new Error('AZURE_STORAGE_ACCOUNT_NAME required');
  let client;
  if (ACCOUNT_KEY) {
    const cred = new StorageSharedKeyCredential(ACCOUNT_NAME, ACCOUNT_KEY);
    client = new BlobServiceClient(`https://${ACCOUNT_NAME}.blob.core.windows.net`, cred);
  } else if (CONNECTION_STRING) {
    client = BlobServiceClient.fromConnectionString(CONNECTION_STRING);
  } else {
    throw new Error('AZURE_STORAGE_ACCESS_KEY or AZURE_STORAGE_CONNECTION_STRING required');
  }
  return client.getContainerClient(CLASSES_CONFIG_CONTAINER);
}

async function ensureTable(tableName) {
  const client = getTableClient(tableName);
  try {
    await client.createTable();
    console.log(`  [+] Tabla "${tableName}" creada`);
  } catch (err) {
    if (err.statusCode === 409) {
      console.log(`  [=] Tabla "${tableName}" ya existe`);
    } else {
      throw err;
    }
  }
}

async function upsertEntity(tableName, entity) {
  const client = getTableClient(tableName);
  await client.upsertEntity(entity, 'Replace');
}

async function seedUserProfiles() {
  console.log('\n--- UserProfiles ---');
  await ensureTable(USER_PROFILES_TABLE);

  const users = [
    { id: 'alu-001', name: 'Lucas Vidmar', email: 'lvidmar@uade.edu.ar', role: 'student' },
    { id: 'alu-002', name: 'María González', email: 'mgonzalez@uade.edu.ar', role: 'student' },
    { id: 'alu-003', name: 'Carlos Mendoza', email: 'cmendoza@uade.edu.ar', role: 'student' },
    { id: 'alu-004', name: 'Sofía Ramírez', email: 'sramirez@uade.edu.ar', role: 'student' },
    { id: 'alu-005', name: 'Tomás Herrera', email: 'therrera@uade.edu.ar', role: 'student' },
    { id: 'doc-001', name: 'Prof. Martín Ferreiro', email: 'mferreiro@uade.edu.ar', role: 'teacher' },
    { id: 'doc-002', name: 'Prof. Laura Medina', email: 'lmedina@uade.edu.ar', role: 'teacher' },
    { id: 'dir-001', name: 'Joaquín García', email: 'jgarciag@uade.edu.ar', role: 'director' },
    // Admin enrollment seed (Story 10.25 / #271): the admin smoke identity needs a
    // seeded enrollment to pass role-gated endpoints. Pilot data key adm-001 matches
    // the ALLOWED_USERS_JSON entry's userId for the admin smoke identity.
    { id: 'adm-001', name: 'Admin Piloto', email: 'adm-smoke@uade.edu.ar', role: 'admin' },
  ];

  for (const user of users) {
    await upsertEntity(USER_PROFILES_TABLE, {
      partitionKey: 'Profiles',
      rowKey: user.id,
      name: user.name,
      email: user.email,
      theme: 'light',
      language: 'es',
      consentAccepted: false,
    });
    console.log(`  [i] ${user.id} — ${user.name}`);
  }
}

async function seedEnrollments() {
  console.log('\n--- Enrollments ---');
  await ensureTable(ENROLLMENTS_TABLE);

  const now = new Date().toISOString();
  const enrollments = [
    // Director (ambas materias)
    { subjectId: 'arq-software-2026', userId: 'dir-001', role: 'director', enrolledAt: now },
    { subjectId: 'diseno-sistemas-2026', userId: 'dir-001', role: 'director', enrolledAt: now },

    // Teachers
    { subjectId: 'arq-software-2026', userId: 'doc-001', role: 'teacher', enrolledAt: now },
    { subjectId: 'diseno-sistemas-2026', userId: 'doc-002', role: 'teacher', enrolledAt: now },

    // Admin (Story 10.25 / #271): seed so the admin smoke identity passes
    // role-gated endpoints (admin is not teacher/director).
    { subjectId: 'arq-software-2026', userId: 'adm-001', role: 'admin', enrolledAt: now },
    { subjectId: 'diseno-sistemas-2026', userId: 'adm-001', role: 'admin', enrolledAt: now },

    // Students in Arquitectura de Software
    { subjectId: 'arq-software-2026', userId: 'alu-001', role: 'student', enrolledAt: now },
    { subjectId: 'arq-software-2026', userId: 'alu-002', role: 'student', enrolledAt: now },
    { subjectId: 'arq-software-2026', userId: 'alu-003', role: 'student', enrolledAt: now },

    // Students in Diseño de Sistemas
    { subjectId: 'diseno-sistemas-2026', userId: 'alu-004', role: 'student', enrolledAt: now },
    { subjectId: 'diseno-sistemas-2026', userId: 'alu-005', role: 'student', enrolledAt: now },

    // alu-004 también cursa Arq. de Software
    { subjectId: 'arq-software-2026', userId: 'alu-004', role: 'student', enrolledAt: now },
    // alu-003 también cursa Diseño de Sistemas
    { subjectId: 'diseno-sistemas-2026', userId: 'alu-003', role: 'student', enrolledAt: now },

    // Economía Internacional Monetaria
    { subjectId: 'eco-internacional-2026', userId: 'dir-001', role: 'director', enrolledAt: now },
    { subjectId: 'eco-internacional-2026', userId: 'doc-002', role: 'teacher', enrolledAt: now },
    { subjectId: 'eco-internacional-2026', userId: 'alu-001', role: 'student', enrolledAt: now },
    { subjectId: 'eco-internacional-2026', userId: 'alu-002', role: 'student', enrolledAt: now },
    { subjectId: 'eco-internacional-2026', userId: 'alu-005', role: 'student', enrolledAt: now },
  ];

  for (const e of enrollments) {
    await upsertEntity(ENROLLMENTS_TABLE, {
      partitionKey: e.subjectId,
      rowKey: e.userId,
      role: e.role,
      status: 'active',
      enrolledAt: e.enrolledAt,
    });
    console.log(`  [i] ${e.userId} → ${e.subjectId} (${e.role})`);
  }
}

async function seedSubjects() {
  console.log('\n--- Subjects (Blob Storage) ---');
  const containerClient = getBlobContainerClient();
  await containerClient.createIfNotExists();
  console.log(`  [=] Container "${CLASSES_CONFIG_CONTAINER}" listo`);

  const subjects = [
    { id: 'arq-software-2026', name: 'Arquitectura de Software 2026', track: 'Tecnicatura', professorIds: ['doc-001'], professors: ['Prof. Martín Ferreiro'], env: 'pilot' },
    { id: 'diseno-sistemas-2026', name: 'Diseño de Sistemas 2026', track: 'Tecnicatura', professorIds: ['doc-002'], professors: ['Prof. Laura Medina'], env: 'pilot' },
    // eco-internacional-2026 NO está en scripts/pilot-enrollments.csv → NO es piloto.
    { id: 'eco-internacional-2026', name: 'Economía Internacional Monetaria 2026', track: 'Licenciatura', professorIds: ['doc-002'], professors: ['Prof. Laura Medina'], env: 'dev' },
  ];

  const blobClient = containerClient.getBlockBlobClient('subjects.json');
  const content = JSON.stringify(subjects, null, 2);
  await blobClient.upload(content, content.length, {
    blobHTTPHeaders: { blobContentType: 'application/json' },
  });
  console.log(`  [i] subjects.json subido con ${subjects.length} materias`);
}

async function seedClasses() {
  console.log('\n--- Classes ---');
  await ensureTable(CLASSES_TABLE);

  const classesBySubject = {
    'arq-software-2026': [
      {
        id: 'class-01', title: 'Clase 1 — Introducción a Arquitecturas de Software',
        date: '2026-03-05', topics: ['Definición de arquitectura', 'Patrones arquitectónicos', 'Atributos de calidad'],
        summaryReady: true, professorIds: ['doc-001'], studentIds: ['alu-001', 'alu-002', 'alu-003', 'alu-004'],
        env: 'pilot',
      },
      {
        id: 'class-02', title: 'Clase 2 — Estilos Arquitectónicos',
        date: '2026-03-12', topics: ['Arquitectura en capas', 'Cliente-Servidor', 'Microservicios', 'Event-Driven'],
        summaryReady: true, professorIds: ['doc-001'], studentIds: ['alu-001', 'alu-002', 'alu-003', 'alu-004'],
        env: 'pilot',
      },
      {
        id: 'class-03', title: 'Clase 3 — Arquitectura Hexagonal y DDD',
        date: '2026-03-19', topics: ['Puertos y adaptadores', 'Domain-Driven Design', 'Bounded Contexts', 'Aggregates'],
        summaryReady: false, professorIds: ['doc-001'], studentIds: ['alu-001', 'alu-002', 'alu-003', 'alu-004'],
        env: 'pilot',
      },
      {
        id: 'class-04', title: 'Clase 4 — Patrones SAGA y CQRS',
        date: '2026-03-26', topics: ['SAGA pattern', 'CQRS', 'Event Sourcing', 'Consistencia eventual'],
        summaryReady: false, professorIds: ['doc-001'], studentIds: ['alu-001', 'alu-002', 'alu-003', 'alu-004'],
        env: 'pilot',
      },
      {
        id: 'class-05', title: 'Clase 5 — API Design & REST',
        date: '2026-04-02', topics: ['REST constraints', 'OpenAPI', 'Versionado', 'HATEOAS'],
        summaryReady: false, professorIds: ['doc-001'], studentIds: ['alu-001', 'alu-002', 'alu-003', 'alu-004'],
        env: 'pilot',
      },
      {
        id: 'class-06', title: 'Clase 6 — Seguridad en Arquitecturas',
        date: '2026-04-09', topics: ['Zero Trust', 'OAuth 2.0', 'mTLS', 'Defense in depth'],
        summaryReady: false, professorIds: ['doc-001'], studentIds: ['alu-001', 'alu-002', 'alu-003', 'alu-004'],
        env: 'pilot',
      },
    ],
    'diseno-sistemas-2026': [
      {
        id: 'class-ds-01', title: 'Clase 1 — Fundamentos de Diseño de Sistemas',
        date: '2026-03-06', topics: ['Introducción', 'Ciclo de vida del software', 'Metodologías ágiles'],
        summaryReady: true, professorIds: ['doc-002'], studentIds: ['alu-003', 'alu-004', 'alu-005'],
        env: 'pilot',
      },
      {
        id: 'class-ds-02', title: 'Clase 2 — Análisis de Requerimientos',
        date: '2026-03-13', topics: ['Requerimientos funcionales', 'Requerimientos no funcionales', 'Casos de uso'],
        summaryReady: true, professorIds: ['doc-002'], studentIds: ['alu-003', 'alu-004', 'alu-005'],
        env: 'pilot',
      },
      {
        id: 'class-ds-03', title: 'Clase 3 — Diagramas UML',
        date: '2026-03-20', topics: ['Diagrama de clases', 'Diagrama de secuencia', 'Diagrama de actividades'],
        summaryReady: false, professorIds: ['doc-002'], studentIds: ['alu-003', 'alu-004', 'alu-005'],
        env: 'pilot',
      },
    ],
    'eco-internacional-2026': [
      { id: 'eco-01', title: 'Clase 1 — El sistema financiero internacional y el mercado de divisas', date: '2026-03-13', topics: ['Tipos de cambio presente y futuro', 'Componentes de la balanza de pagos', 'Conceptos contables básicos', 'Regímenes cambiarios y monetarios', 'Dinero, precios y tasas de interés', 'Interrelación entre mercados de dinero y de divisas', 'Tipo de cambio nominal y real'], summaryReady: false, professorIds: ['doc-002'], studentIds: ['alu-001', 'alu-002', 'alu-005'], env: 'dev' },
      { id: 'eco-02', title: 'Clase 2 — Ajuste interno y externo', date: '2026-03-20', topics: ['Enfoques elasticidad y absorción', 'El problema del equilibrio interno y externo', 'El modelo de Mundell Fleming y la clasificación efectiva de mercados: alcance y limitaciones'], summaryReady: false, professorIds: ['doc-002'], studentIds: ['alu-001', 'alu-002', 'alu-005'], env: 'dev' },
      { id: 'eco-03', title: 'Clase 3 — Enfoque monetario y el trilema macroeconómico', date: '2026-03-27', topics: ['Enfoque monetario de la balanza de pagos y del tipo de cambio', 'Paridad de poder adquisitivo: relevancia teórica y evidencia empírica', 'Movilidad de capitales, regímenes cambiarios y la imposibilidad triple o trilema macroeconómico'], summaryReady: false, professorIds: ['doc-002'], studentIds: ['alu-001', 'alu-002', 'alu-005'], env: 'dev' },
      { id: 'eco-04', title: 'Clase 4 — Feriado: Viernes Santo (sin actividad académica)', date: '2026-04-03', topics: ['Sin actividad académica'], summaryReady: false, professorIds: ['doc-002'], studentIds: ['alu-001', 'alu-002', 'alu-005'], env: 'dev' },
      { id: 'eco-05', title: 'Clase 5 — Tipo de cambio real y ajuste de largo plazo', date: '2026-04-10', topics: ['Tipo de cambio real y ajuste interno y externo', 'Tipo de cambio real de equilibrio', 'Efectos de las productividades relativas y la paradoja de Balassa-Samuelson', 'Rol de los flujos de capitales y la paridad de intereses', 'Política monetaria y fiscal: efectos de corto plazo con precios flexibles', 'Ajuste de largo plazo', 'Rol del tipo de cambio real'], summaryReady: false, professorIds: ['doc-002'], studentIds: ['alu-001', 'alu-002', 'alu-005'], env: 'dev' },
      { id: 'eco-06', title: 'Clase 6 — El modelo de Dornbusch y Frankel', date: '2026-04-17', topics: ['El modelo de Dornbusch con precios rígidos en corto plazo y sobrerreacción overshooting', 'El modelo de Frankel de diferencias de tasas reales de interés', 'Rol de la sustitución imperfecta entre activos internos y externos'], summaryReady: false, professorIds: ['doc-002'], studentIds: ['alu-001', 'alu-002', 'alu-005'], env: 'dev' },
      { id: 'eco-07', title: 'Clase 7 — Primer examen parcial', date: '2026-04-24', topics: ['Evaluación correspondiente a las Unidades 1 a 3'], summaryReady: false, professorIds: ['doc-002'], studentIds: ['alu-001', 'alu-002', 'alu-005'], env: 'dev' },
      { id: 'eco-08', title: 'Clase 8 — Feriado: Día del Trabajador (sin actividad académica)', date: '2026-05-01', topics: ['Sin actividad académica'], summaryReady: false, professorIds: ['doc-002'], studentIds: ['alu-001', 'alu-002', 'alu-005'], env: 'dev' },
      { id: 'eco-09', title: 'Clase 9 — Modelo de equilibrio de cartera', date: '2026-05-08', topics: ['Las hipótesis de mercados eficientes y de expectativas insesgadas', 'Evidencia empírica y problemas de medición'], summaryReady: false, professorIds: ['doc-002'], studentIds: ['alu-001', 'alu-002', 'alu-005'], env: 'dev' },
      { id: 'eco-10', title: 'Clase 10 — Modelos de ajuste cambiario', date: '2026-05-15', topics: ['Modelos simples de ajuste con tipo de cambio fijo', 'Modelos dinámicos con tipo de cambio flotante'], summaryReady: false, professorIds: ['doc-002'], studentIds: ['alu-001', 'alu-002', 'alu-005'], env: 'dev' },
      { id: 'eco-11', title: 'Clase 11 — Dinámica del tipo de cambio con regímenes intermedios', date: '2026-05-22', topics: ['Flotación administrada', 'Crawling peg tablitas cambiarias'], summaryReady: false, professorIds: ['doc-002'], studentIds: ['alu-001', 'alu-002', 'alu-005'], env: 'dev' },
      { id: 'eco-12', title: 'Clase 12 — Sustentabilidad de tipo de cambio fijo', date: '2026-05-29', topics: ['Devaluaciones: determinantes y efectos'], summaryReady: false, professorIds: ['doc-002'], studentIds: ['alu-001', 'alu-002', 'alu-005'], env: 'dev' },
      { id: 'eco-13', title: 'Clase 13 — Sustitución de monedas y flujos de capitales', date: '2026-06-05', topics: ['Sustitución de monedas: determinantes y consecuencias', 'Implicancia de detención súbita de ingreso de capitales y de dolarización de pasivos'], summaryReady: false, professorIds: ['doc-002'], studentIds: ['alu-001', 'alu-002', 'alu-005'], env: 'dev' },
      { id: 'eco-14', title: 'Clase 14 — Crisis de balanza de pagos (1ra y 2da generación)', date: '2026-06-12', topics: ['Ataques especulativos y crisis de balanza de pagos: modelos de primera y segunda generación'], summaryReady: false, professorIds: ['doc-002'], studentIds: ['alu-001', 'alu-002', 'alu-005'], env: 'dev' },
      { id: 'eco-15', title: 'Clase 15 — Crisis de balanza de pagos (3ra generación)', date: '2026-06-19', topics: ['Ataques especulativos y crisis de balanza de pagos: modelos de tercera generación'], summaryReady: false, professorIds: ['doc-002'], studentIds: ['alu-001', 'alu-002', 'alu-005'], env: 'dev' },
      { id: 'eco-16', title: 'Clase 16 — Segundo examen parcial', date: '2026-06-26', topics: ['Evaluación correspondiente a las Unidades 3 y 4'], summaryReady: false, professorIds: ['doc-002'], studentIds: ['alu-001', 'alu-002', 'alu-005'], env: 'dev' },
      { id: 'eco-17', title: 'Clase 17 — El sistema financiero internacional', date: '2026-06-27', topics: ['El sistema financiero internacional: evolución reciente', 'Del sistema de Bretton Woods a la nueva arquitectura financiera internacional', 'Desarrollo de los mercados de euromonedas y de eurobonos', 'Desarrollo de los mercados de derivados'], summaryReady: false, professorIds: ['doc-002'], studentIds: ['alu-001', 'alu-002', 'alu-005'], env: 'dev' },
      { id: 'eco-18', title: 'Clase 18 — Crisis financieras y uniones monetarias', date: '2026-07-03', topics: ['El sistema monetario europeo desde la salida de Bretton Woods', 'Teoría de uniones monetarias óptimas y el caso del euro', 'Crisis financieras y su transmisión internacional', 'Regulaciones macroprudenciales: objetivos y evidencia reciente'], summaryReady: false, professorIds: ['doc-002'], studentIds: ['alu-001', 'alu-002', 'alu-005'], env: 'dev' },
      { id: 'eco-19', title: 'Clase 19 — Examen recuperatorio / Examen final adelantado', date: '2026-07-10', topics: ['Instancia de recuperación o final adelantado'], summaryReady: false, professorIds: ['doc-002'], studentIds: ['alu-001', 'alu-002', 'alu-005'], env: 'dev' },
      { id: 'eco-20', title: 'Clase 20 — Examen final regular', date: '2026-07-17', topics: ['Evaluación final correspondiente a las Unidades 1 a 5'], summaryReady: false, professorIds: ['doc-002'], studentIds: ['alu-001', 'alu-002', 'alu-005'], env: 'dev' },
    ],
  };

  for (const [subjectId, classes] of Object.entries(classesBySubject)) {
    for (const classData of classes) {
      await upsertEntity(CLASSES_TABLE, {
        partitionKey: subjectId,
        rowKey: classData.id,
        title: classData.title,
        date: classData.date,
        topics: JSON.stringify(classData.topics),
        summaryReady: classData.summaryReady,
        professorIds: JSON.stringify(classData.professorIds),
        studentIds: JSON.stringify(classData.studentIds),
        env: classData.env || 'pilot',
      });
      console.log(`  [i] ${subjectId} / ${classData.id} — ${classData.title}`);
    }
  }
}

async function seedMaterials() {
  console.log('\n--- Materials ---');
  await ensureTable(MATERIALS_TABLE);

  const materials = [
    // Arquitectura de Software
    {
      subjectId: 'arq-software-2026', materialId: 'm-01',
      classIds: ['class-01'], type: 'transcript', filename: 'clase1_transcripcion.txt',
      status: 'ready', uploadedAt: '2026-03-05T10:00:00Z', mimeType: 'text/plain',
      priority: 'normal', env: 'pilot',
    },
    {
      subjectId: 'arq-software-2026', materialId: 'm-02',
      classIds: ['class-01'], type: 'presentation', filename: 'clase1_slides.pdf',
      status: 'ready', uploadedAt: '2026-03-05T10:05:00Z', mimeType: 'application/pdf',
      priority: 'normal', env: 'pilot',
    },
    {
      subjectId: 'arq-software-2026', materialId: 'm-03',
      classIds: ['class-02'], type: 'transcript', filename: 'clase2_transcripcion.vtt',
      status: 'ready', uploadedAt: '2026-03-12T10:00:00Z', mimeType: 'text/vtt',
      priority: 'high', env: 'pilot',
    },
    {
      subjectId: 'arq-software-2026', materialId: 'm-04',
      classIds: ['class-02'], type: 'presentation', filename: 'clase2_estilos.pptx',
      status: 'ready', uploadedAt: '2026-03-12T10:02:00Z', mimeType: 'application/vnd.ms-powerpoint',
      priority: 'normal', env: 'pilot',
    },
    {
      subjectId: 'arq-software-2026', materialId: 'm-05',
      classIds: ['class-02'], type: 'notes', filename: 'apuntes_clase2.docx',
      status: 'ready', uploadedAt: '2026-03-12T11:00:00Z', mimeType: 'application/docx',
      priority: 'low', env: 'pilot',
    },
    {
      subjectId: 'arq-software-2026', materialId: 'm-06',
      classIds: ['class-03'], type: 'transcript', filename: 'clase3_transcript.txt',
      status: 'ready', uploadedAt: '2026-03-19T10:00:00Z', mimeType: 'text/plain',
      priority: 'normal', env: 'pilot',
    },
  ];

  for (const m of materials) {
    await upsertEntity(MATERIALS_TABLE, {
      partitionKey: m.subjectId,
      rowKey: m.materialId,
      classIds: JSON.stringify(m.classIds),
      type: m.type,
      filename: m.filename,
      status: m.status,
      uploadedAt: m.uploadedAt,
      mimeType: m.mimeType,
      priority: m.priority,
      env: m.env || 'pilot',
    });
    console.log(`  [i] ${m.subjectId} / ${m.materialId} — ${m.filename}`);
  }
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Seed scripts cannot run in production');
    process.exit(1);
  }
  console.log('=== Seed Inicial: Dashboard Educativo UADE ===\n');

  try {
    await seedUserProfiles();
    await seedEnrollments();
    await seedSubjects();
    await seedClasses();
    await seedMaterials();

    console.log('\n=== Seed completado exitosamente ===');
  } catch (err) {
    console.error('\n[ERROR] Seed falló:', err);
    process.exit(1);
  }
}

main();
