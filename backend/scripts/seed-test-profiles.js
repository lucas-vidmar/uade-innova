#!/usr/bin/env node

// SEED SCRIPT — Solo para desarrollo/piloto. No ejecutar en producción.

/**
 * seed-test-profiles.js — Seed mock student profiles into Azure Table Storage
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
 */

import { TableClient, AzureNamedKeyCredential } from '@azure/data-tables';

const ACCOUNT_NAME = process.env.AZURE_STORAGE_ACCOUNT_NAME;
const ACCOUNT_KEY = process.env.AZURE_STORAGE_ACCESS_KEY;
const CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;

if (!CONNECTION_STRING && (!ACCOUNT_NAME || !ACCOUNT_KEY)) {
  console.error('AZURE_STORAGE_ACCOUNT_NAME and AZURE_STORAGE_ACCESS_KEY (or AZURE_STORAGE_CONNECTION_STRING) are required');
  process.exit(1);
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

const testStudents = [
  { id: 'test-alu-001', displayName: 'Ana García', mail: 'agarcia@estudiantes.uade.edu.ar', subject: 'arq-software-2026' },
  { id: 'test-alu-002', displayName: 'Carlos López', mail: 'clopez@estudiantes.uade.edu.ar', subject: 'arq-software-2026' },
  { id: 'test-alu-003', displayName: 'Lucía Fernández', mail: 'lfernandez@estudiantes.uade.edu.ar', subject: 'matematica-2026' },
  { id: 'test-alu-004', displayName: 'Martín Silva', mail: 'msilva@estudiantes.uade.edu.ar', subject: 'matematica-2026' },
  { id: 'test-alu-005', displayName: 'Camila Rojas', mail: 'crojas@estudiantes.uade.edu.ar', subject: 'matematica-2026' },
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
    });
    console.log(`Profile created: ${student.id}`);
  }
}

async function seedEnrollments() {
  const enrollmentsClient = getTableServiceClient(ENROLLMENTS_TABLE);
  await enrollmentsClient.createTable();

  for (const student of testStudents) {
    await enrollmentsClient.upsertEntity({
      partitionKey: student.id,
      rowKey: student.subject,
      subjectId: student.subject,
      userId: student.id,
      role: 'student',
      status: 'active',
    });
    console.log(`Enrollment created: ${student.id} → ${student.subject}`);
  }
}

async function main() {
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
