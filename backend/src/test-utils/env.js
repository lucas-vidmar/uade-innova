/**
 * test-utils/env.js — Helper para tests
 * Setea env vars mínimas para que los tests no dependan de fake keys inline.
 *
 * Uso:
 *   import { setupTestEnv } from '../test-utils/env.js';
 *   setupTestEnv();
 */

export function setupTestEnv() {
  process.env.PINECONE_HOST = process.env.PINECONE_HOST || 'https://test-index-test.svc.pinecone.io';
  process.env.PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'test-index';
  process.env.PINECONE_API_KEY = process.env.PINECONE_API_KEY || 'fake-key';
  delete process.env.PINECONE_NAMESPACE;
}
