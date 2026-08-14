/**
 * services/upload-quota.js — Per-teacher file upload quota (#222)
 *
 * Tracks cumulative upload usage per teacher in Table Storage so a single
 * teacher cannot exhaust the shared token/storage budget. Enforcement happens
 * in `ingest-material` (check before upload, record after success) and release
 * on `delete-material`.
 *
 * Limits are configured via CONFIG.uploadQuota (env-overridable):
 *   - maxFilesPerTeacher  : UPLOAD_QUOTA_MAX_FILES_PER_TEACHER   (default 100)
 *   - maxBytesPerTeacher  : UPLOAD_QUOTA_MAX_BYTES_PER_TEACHER   (default 5 GiB)
 */

import { CONFIG } from '../config.js';
import { getTableClient } from './storage.js';

const QUOTA_TABLE = CONFIG.uploadQuota.table;

function sanitizeKey(key) {
  return String(key || 'anonymous').replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Reads the current upload usage for a teacher.
 * @param {string} teacherId
 * @returns {Promise<{materialCount:number, totalBytes:number}>}
 */
export async function getTeacherUploadUsage(teacherId) {
  const rowKey = sanitizeKey(teacherId);
  const client = getTableClient(QUOTA_TABLE);
  try {
    const entity = await client.getEntity('quota', rowKey);
    return {
      materialCount: Number(entity.materialCount) || 0,
      totalBytes: Number(entity.totalBytes) || 0,
    };
  } catch {
    return { materialCount: 0, totalBytes: 0 };
  }
}

/**
 * Checks whether a teacher may upload a new file of the given size.
 * @param {string} teacherId
 * @param {number} incomingBytes
 * @returns {Promise<{allowed:boolean, reason?:string, used:{materialCount:number,totalBytes:number}, limits:{maxFilesPerTeacher:number,maxBytesPerTeacher:number}}>}
 */
export async function checkUploadQuota(teacherId, incomingBytes = 0) {
  const used = await getTeacherUploadUsage(teacherId);
  const limits = {
    maxFilesPerTeacher: Number(CONFIG.uploadQuota.maxFilesPerTeacher) || 100,
    maxBytesPerTeacher: Number(CONFIG.uploadQuota.maxBytesPerTeacher) || 0,
  };

  if (used.materialCount >= limits.maxFilesPerTeacher) {
    return { allowed: false, reason: 'files', used, limits };
  }

  const incoming = Math.max(0, Number(incomingBytes) || 0);
  if (limits.maxBytesPerTeacher > 0 && used.totalBytes + incoming > limits.maxBytesPerTeacher) {
    return { allowed: false, reason: 'bytes', used, limits };
  }

  return { allowed: true, used, limits };
}

/**
 * Records a successful upload against a teacher's quota.
 * @param {string} teacherId
 * @param {number} bytes
 * @returns {Promise<void>}
 */
export async function recordUpload(teacherId, bytes = 0) {
  const rowKey = sanitizeKey(teacherId);
  const used = await getTeacherUploadUsage(teacherId);
  const client = getTableClient(QUOTA_TABLE);
  try {
    await client.createTable();
  } catch (err) {
    if (err?.statusCode !== 409) throw err;
  }
  await client.upsertEntity({
    partitionKey: 'quota',
    rowKey,
    materialCount: used.materialCount + 1,
    totalBytes: used.totalBytes + Math.max(0, Number(bytes) || 0),
  }, 'Merge');
}

/**
 * Releases a deleted file from a teacher's quota (best-effort, floors at 0).
 * @param {string} teacherId
 * @param {number} bytes
 * @returns {Promise<void>}
 */
export async function releaseUpload(teacherId, bytes = 0) {
  const rowKey = sanitizeKey(teacherId);
  const used = await getTeacherUploadUsage(teacherId);
  if (used.materialCount <= 0 && used.totalBytes <= 0) return;

  const client = getTableClient(QUOTA_TABLE);
  await client.upsertEntity({
    partitionKey: 'quota',
    rowKey,
    materialCount: Math.max(0, used.materialCount - 1),
    totalBytes: Math.max(0, used.totalBytes - Math.max(0, Number(bytes) || 0)),
  }, 'Merge');
}
