#!/usr/bin/env node

// SEED SCRIPT — Solo para desarrollo/piloto. No ejecutar en producción.

/**
 * seed-enrollments.js — Bulk insert enrollment records into Azure Table Storage
 * from a CSV file (scripts/pilot-enrollments.csv).
 *
 * Usage:
 *   node scripts/seed-enrollments.js
 *
 * Required environment variables:
 *   AZURE_STORAGE_ACCOUNT_NAME  - Storage account name
 *   AZURE_STORAGE_ACCESS_KEY    - Storage account key (or AZURE_STORAGE_CONNECTION_STRING)
 *   AZURE_TABLE_ENROLLMENTS     - Table name (defaults to "Enrollments")
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { TableClient, AzureNamedKeyCredential } from '@azure/data-tables';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ACCOUNT_NAME = process.env.AZURE_STORAGE_ACCOUNT_NAME;
const ACCOUNT_KEY = process.env.AZURE_STORAGE_ACCESS_KEY;
const CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;
const TABLE_NAME = process.env.AZURE_TABLE_ENROLLMENTS || 'Enrollments';
const CSV_PATH = process.env.ENROLLMENTS_CSV || join(__dirname, 'pilot-enrollments.csv');

function getTableClient() {
  if (CONNECTION_STRING === 'UseDevelopmentStorage=true' || process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development') {
    if (CONNECTION_STRING) {
      return TableClient.fromConnectionString(CONNECTION_STRING, TABLE_NAME);
    }
    return new TableClient(
      `http://127.0.0.1:10002/${ACCOUNT_NAME || 'devstoreaccount1'}`,
      TABLE_NAME
    );
  }

  if (!ACCOUNT_NAME || !ACCOUNT_KEY) {
    throw new Error('AZURE_STORAGE_ACCOUNT_NAME and AZURE_STORAGE_ACCESS_KEY are required (or set AZURE_STORAGE_CONNECTION_STRING)');
  }

  return new TableClient(
    `https://${ACCOUNT_NAME}.table.core.windows.net`,
    TABLE_NAME,
    new AzureNamedKeyCredential(ACCOUNT_NAME, ACCOUNT_KEY)
  );
}

function parseCsv(filePath) {
  const raw = readFileSync(filePath, 'utf-8').trim();
  const lines = raw.split('\n');
  const headers = lines[0].split(',').map(h => h.trim());

  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim());
    const record = {};
    headers.forEach((header, i) => {
      record[header] = values[i] || '';
    });
    return record;
  });
}

async function main() {
  console.log(`[Seed] Seeding enrollments to table "${TABLE_NAME}"...`);

  const client = getTableClient();

  // Ensure table exists
  try {
    await client.createTable();
    console.log(`[Seed] Table "${TABLE_NAME}" created.`);
  } catch (err) {
    if (err.statusCode === 409) {
      console.log(`[Seed] Table "${TABLE_NAME}" already exists.`);
    } else {
      throw err;
    }
  }

  const records = parseCsv(CSV_PATH);
  console.log(`[Seed] Parsed ${records.length} records from ${CSV_PATH}`);

  let inserted = 0;
  let errors = 0;

  for (const record of records) {
    const entity = {
      partitionKey: record.subjectId,
      rowKey: record.userId,
      role: record.role,
      status: record.status || 'active',
      enrolledAt: record.enrolledAt || new Date().toISOString(),
    };

    try {
      await client.upsertEntity(entity, 'Replace');
      inserted++;
    } catch (err) {
      console.error(`[Seed] Error upserting ${record.subjectId}/${record.userId}:`, err.message);
      errors++;
    }
  }

  console.log(`[Seed] Done. Inserted: ${inserted}, Errors: ${errors}`);
}

main().catch(err => {
  console.error('[Seed] Fatal error:', err);
  process.exit(1);
});