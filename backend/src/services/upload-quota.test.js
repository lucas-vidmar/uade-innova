import { test, mock } from 'node:test';
import assert from 'node:assert';

process.env.AZURE_TABLE_UPLOAD_QUOTA = 'UploadQuota';
process.env.UPLOAD_QUOTA_MAX_FILES_PER_TEACHER = '3';
process.env.UPLOAD_QUOTA_MAX_BYTES_PER_TEACHER = String(1024 * 1024); // 1 MiB

const tableData = { UploadQuota: [] };

function createTableClient() {
  const data = tableData.UploadQuota;
  return {
    createTable: async () => true,
    upsertEntity: async (entity, mode = 'Merge') => {
      const idx = data.findIndex((row) => row.partitionKey === entity.partitionKey && row.rowKey === entity.rowKey);
      if (idx === -1) {
        data.push({ ...entity });
        return;
      }
      if (mode === 'Replace') {
        data[idx] = { ...entity };
      } else {
        data[idx] = { ...data[idx], ...entity };
      }
    },
    getEntity: async (partitionKey, rowKey) => {
      const row = data.find((r) => r.partitionKey === partitionKey && r.rowKey === rowKey);
      if (!row) {
        const err = new Error('Not Found');
        err.statusCode = 404;
        throw err;
      }
      return row;
    },
  };
}

mock.module('./storage.js', {
  namedExports: {
    getTableClient: mock.fn(() => createTableClient()),
  },
});

const { getTeacherUploadUsage, checkUploadQuota, recordUpload, releaseUpload } = await import('./upload-quota.js');

function resetData() {
  tableData.UploadQuota.length = 0;
}

test('EMPTY — new teacher starts at zero usage', async () => {
  resetData();
  const usage = await getTeacherUploadUsage('teacher-1');
  assert.deepEqual(usage, { materialCount: 0, totalBytes: 0 });
});

test('ALLOWED — usage under limits permits an upload', async () => {
  resetData();
  await recordUpload('teacher-1', 1000);
  const result = await checkUploadQuota('teacher-1', 500);
  assert.equal(result.allowed, true);
  assert.equal(result.used.materialCount, 1);
  assert.equal(result.used.totalBytes, 1000);
});

test('FILES_LIMIT — exceeding max files returns allowed=false reason files', async () => {
  resetData();
  await recordUpload('teacher-1', 100);
  await recordUpload('teacher-1', 100);
  await recordUpload('teacher-1', 100);
  const result = await checkUploadQuota('teacher-1', 100);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'files');
  assert.equal(result.limits.maxFilesPerTeacher, 3);
});

test('BYTES_LIMIT — exceeding max bytes returns allowed=false reason bytes', async () => {
  resetData();
  await recordUpload('teacher-1', 1024 * 1024); // full 1 MiB budget
  const result = await checkUploadQuota('teacher-1', 100);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'bytes');
});

test('RELEASE — deleting a file decrements count and bytes (floors at 0)', async () => {
  resetData();
  await recordUpload('teacher-1', 500);
  await recordUpload('teacher-1', 500);
  assert.deepEqual(await getTeacherUploadUsage('teacher-1'), { materialCount: 2, totalBytes: 1000 });

  await releaseUpload('teacher-1', 500);
  assert.deepEqual(await getTeacherUploadUsage('teacher-1'), { materialCount: 1, totalBytes: 500 });

  await releaseUpload('teacher-1', 500);
  await releaseUpload('teacher-1', 500);
  assert.deepEqual(await getTeacherUploadUsage('teacher-1'), { materialCount: 0, totalBytes: 0 });
});

test('RELEASE_NOOP — release on empty usage is a no-op', async () => {
  resetData();
  await releaseUpload('teacher-ghost', 100);
  assert.deepEqual(await getTeacherUploadUsage('teacher-ghost'), { materialCount: 0, totalBytes: 0 });
});

test('QUOTA_IS_PER_TEACHER — teachers do not share quotas', async () => {
  resetData();
  await recordUpload('teacher-a', 1024 * 1024); // exhaust teacher-a bytes
  const resultA = await checkUploadQuota('teacher-a', 1);
  assert.equal(resultA.allowed, false);

  const resultB = await checkUploadQuota('teacher-b', 1024 * 1024);
  assert.equal(resultB.allowed, true);
});
