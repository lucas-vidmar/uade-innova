# Reindex Vector classId Migration — Runbook

**Story:** 2.156  
**Purpose:** Backfill the `classId` metadata field in legacy Pinecone vectors to enable exact-classId filtering (Issue #160).  
**Script:** `backend/scripts/reindex-vector-classid.js`

---

## Prerequisites

1. **Environment variables set** (same as backend Functions):
   - `PINECONE_HOST` — Pinecone index host URL
   - `PINECONE_INDEX_NAME` — Pinecone index name (default: `dashboard-edu-pilot`)
   - `PINECONE_API_KEY` — Pinecone API key
   - `PINECONE_NAMESPACE` — (optional) Pinecone namespace
   - `AZURE_STORAGE_ACCOUNT_NAME` — Azure Storage account name
   - `AZURE_STORAGE_ACCESS_KEY` — Azure Storage account key

2. **Azure Table Storage** `materials` table must be populated with historical material metadata (containing `classIds`).

3. **Node.js 20+** installed.

---

## Execution

### Step 1: Dry Run (preview changes)

```bash
node backend/scripts/reindex-vector-classid.js --dry-run
```

This lists all vectors missing `classId` and shows what `classId` value would be assigned, WITHOUT making any changes to Pinecone.

Review the output to ensure the resolution logic is correct.

### Step 2: Live Migration

```bash
node backend/scripts/reindex-vector-classid.js
```

This performs the actual metadata updates in Pinecone. Each corrected vector is re-upserted with `classId` added while preserving all existing values and metadata.

### Step 3: Verification

After migration, verify by querying Pinecone:

```javascript
// Check that legacy vectors now have classId
const vectors = await fetchVectorsByIds(sampleIds);
console.log(vectors.every(v => v.metadata.classId));
```

You can also run the script again — it should report `Already OK: N` for all vectors since they now have `classId`.

---

## Expected Output (Summary)

```
=== Migration Summary ===
Mode:               LIVE
Total scanned:      4520
Already OK:         2100
Updated:            2410
Failed (no classId): 10
Duration:           3.45s
========================
```

- **Total scanned:** All vectors in the index
- **Already OK:** Vectors that already had `classId` (skipped)
- **Updated:** Vectors successfully corrected
- **Failed:** Vectors where `classId` could not be resolved (no `classIds` in metadata AND no matching entry in Table Storage)
- **Duration:** Total execution time

---

## Rollback

This migration ONLY adds the `classId` field. No existing metadata is modified.

To roll back: create a script that re-upserts vectors with `classId` deleted from metadata while preserving `classIds`:

```javascript
// Simplified rollback example
const vectors = await fetchVectorsByIds(affectedIds);
const rollbackVectors = vectors.map(v => ({
  id: v.id,
  values: v.values,
  metadata: { ...v.metadata, classId: undefined },
}));
await upsertChunks(rollbackVectors);
```

**No data loss risk** — the `classIds` array remains untouched.

---

## Safety Notes

1. **Always run dry-run first.** The script will show you exactly what would change.
2. **Ideal to run during low-traffic periods.** Although metadata-only upserts have minimal impact, running during peak usage could affect query latency.
3. **Table Storage lookup is fault-tolerant.** If a material lookup fails (network error, missing data), that vector is logged as `failed` and skipped. The migration continues.
4. **Vectors without `materialId` or `subjectId` in metadata** will fail to resolve and will be logged. These require manual investigation.
5. **Namespace support:** The script respects `PINECONE_NAMESPACE`. Ensure it's set correctly if your index uses namespaces.

---

## Troubleshooting

| Symptom | Likely Cause | Solution |
|---------|-------------|----------|
| `PINECONE_HOST is missing` | Missing env var | Set `PINECONE_HOST` (check .env) |
| `Timeout consultando Pinecone` | Network issue or large index | Check connectivity, increase timeout, run in smaller batches |
| High failed count | Missing Table Storage data | Verify `materials` table has entries for failed materialIds |
| Script hangs | Large index pagination | Wait — it should complete; each batch is ~100 vectors |
|
