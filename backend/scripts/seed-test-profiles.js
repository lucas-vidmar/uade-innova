#!/usr/bin/env node

// SEED SCRIPT — SOLO para TEST/desarrollo. Crea fixtures con env=test que
// NUNCA deben ingresar al entorno del piloto ni a producción (Story 10.23).

/**
 * seed-test-profiles.js — Seed mock student profiles into Azure Table Storage
 *
 * ⚠️ FIXTURES DE TEST (env=test): crea perfiles e inscripciones de alumnos de
 * prueba (test-alu-001..005) SOLO para desarrollo. test-alu-001/002 se
 * inscriben en `arq-software-2026` (que ES una materia piloto) únicamente para
 * ejercitar el aislamiento de permisos en dev; el guard `assertTestScopeOnly`
 * bloquea la ejecución contra el storage del piloto/producción, de modo que
 * estas fixtures nunca ingresan al entorno real.
 *
 * Creates profiles and enrollments for 5 test students to test permission
 * isolation between subjects.
 *
 * Usage:
 *   node scripts/seed-test-profiles.js
 *
 * Required environment variables:
 *   AZURE_STORAGE_ACCOUNT_NAME  - Storage account name
 *   AZURE_STORAGE_ACCESS_KEY    - Storage account key
 *   (or AZURE_STORAGE_CONNECTION_STRING)
 *
 * Safety:
 *   SEED_TEST_PROFILES_ALLOW_PILOT=true  - (NO recomendado) fuerza la ejecución
 *                                          contra un storage detectado como piloto.
 */

import { TableClient, AzureNamedKeyCredential } from '@azure/data-tables';

const ACCOUNT_NAME = process.env.AZURE_STORAGE_ACCOUNT_NAME;
const ACCOUNT_KEY = process.env.AZURE_STORAGE_ACCESS_KEY;
const CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;

if (!CONNECTION_STRING && (!ACCOUNT_NAME || !ACCOUNT_KEY)) {
  console.error('AZURE_STORAGE_ACCOUNT_NAME and AZURE_STORAGE_ACCESS_KEY (or AZURE_STORAGE_CONNECTION_STRING) are required');
  process.exit(1);
}

// Marca de naming del storage del piloto/producción (AGENTS.md §7.3: stdashboard{token}).
const PILOT_STORAGE_MARKER = 'stdashboard';

function assertTestScopeOnly() {
  const account = String(ACCOUNT_NAME || '').toLowerCase();
  const isPilotStorage = account.includes(PILOT_STORAGE_MARKER);
  const isProduction = process.env.NODE_ENV === 'production';
  if ((isPilotStorage || isProduction) && process.env.SEED_TEST_PROFILES_ALLOW_PILOT !== 'true') {
    console.error('[FATAL] seed-test-profiles.js crea fixtures de TEST (env=test). No puede ejecutarse contra el storage del piloto/producción.');
    console.error(`         Storage detectado: ${ACCOUNT_NAME || '(no definido)'}.`);
    console.error('         Ejecutalo contra un storage de desarrollo (Azurite) o setea SEED_TEST_PROFILES_ALLOW_PILOT=true SOLO si estás seguro.');
    process.exit(1);
  }
}

const getTableServiceClient = (tableName) => {
  if (CONNECTION_STRING) {
    return TableClient.fromConnectionString(CONNECTION_STRING, tableName);
  }
  const credential = new AzureNamedKeyCredential(ACCOUNT_NAME, ACCOUNT_KEY);
  return new TableClient(`https://${ACCOUNT_NAME}.table.core.windows.net`, tableName, credential);
};

const PROFILES_TABLE = process.env.AZURE_TABLE_PROFILES || 'UserProfiles';
const ENROLLMENTS_TABLE = process.env.AZURE_TABLE_ENROLLMENTS || 'Enrollments';

// env=test: fixtures de prueba, fuera del scope piloto (Story 10.23 / QA-014).
const TEST_ENV = 'test';

const testStudents = [
  { id: 'test-alu-001', displayName: 'Ana García', mail: 'agarcia@estudiantes.uade.edu.ar', subject: 'arq-software-2026', env: TEST_ENV },
  { id: 'test-alu-002', displayName: 'Carlos López', mail: 'clopez@estudiantes.uade.edu.ar', subject: 'arq-software-2026', env: TEST_ENV },
  { id: 'test-alu-003', displayName: 'Lucía Fernández', mail: 'lfernandez@estudiantes.uade.edu.ar', subject: 'matematica-2026', env: TEST_ENV },
  { id: 'test-alu-004', displayName: 'Martín Silva', mail: 'msilva@estudiantes.uade.edu.ar', subject: 'matematica-2026', env: TEST_ENV },
  { id: 'test-alu-005', displayName: 'Camila Rojas', mail: 'crojas@estudiantes.uade.edu.ar', subject: 'matematica-2026', env: TEST_ENV },
];

async function seedProfiles() {
  const profilesClient = getTableServiceClient(PROFILES_TABLE);
  await profilesClient.createTable();

  for (const student of testStudents) {
    await profilesClient.upsertEntity({
      partitionKey: 'student',
      rowKey: student.id,
      displayName: student.displayName,
      mail: student.mail,
      role: 'student',
      env: student.env,
    });
    console.log(`Profile created: ${student.id} (env=${student.env})`);
  }
}

async function seedEnrollments() {
  const enrollmentsClient = getTableServiceClient(ENROLLMENTS_TABLE);
  await enrollmentsClient.createTable();

  for (const student of testStudents) {
    await enrollmentsClient.upsertEntity({
      // Convención state-store: partitionKey=subjectId, rowKey=userId.
      partitionKey: student.subject,
      rowKey: student.id,
      subjectId: student.subject,
      userId: student.id,
      role: 'student',
      status: 'active',
      env: student.env,
    });
    console.log(`Enrollment created: ${student.id} → ${student.subject} (env=${student.env})`);
  }
}

async function main() {
  assertTestScopeOnly();
  console.log('--- Seeding test profiles ---');
  await seedProfiles();
  console.log('--- Seeding test enrollments ---');
  await seedEnrollments();
  console.log('Seed complete.');
}

main().catch(error => {
  console.error('Seed failed:', error);
  process.exit(1);
});
