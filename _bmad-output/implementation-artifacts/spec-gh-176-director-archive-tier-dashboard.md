---
title: 'Issue #176 — Director Archive-Tier Usage Dashboard by Subject and Semester'
type: 'feature'
created: '2026-06-20'
status: 'in-review'
baseline_commit: 'f1995388f60444924b000ce8592009dc6a79bc99'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/infra/modules/storage.bicep'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Directors have no visibility into Archive-tier blob storage — how many blobs are archived, how much space they consume, or which subjects/semesters contribute to cooling costs. The existing `storage-lifecycle` compliance endpoint only detects drift, not aggregate usage.

**Approach:** Add a `GET /api/archive-usage` endpoint that scans both `class-materials` and `processed` containers, groups blobs by access tier (Archive vs Hot/Cool), and breaks down Archive blobs by `subjectId` (inferred from blob path) and semester prefix. Surface this data in a new director-facing "Archivo en Frío" page with filter controls.

## Boundaries & Constraints

**Always:**
- Blob enumeration uses `listBlobsFlat` with `includeMetadata=false, includeTags=false` for performance
- Subject inferred from blob path: `class-materials/semester-YYYY/class-{classId}/...` or `processed/semester-YYYY/class-{classId}/...`
- Semester prefix = path segment after container but before `class-` (e.g. `semester-2026-1`)
- Results return: total blob count (Archive), total size GB (Archive), breakdown by `subjectId` + semester, `lastUpdatedAt` ISO timestamp, `dataSource` note
- Frontend: new director page at `#/director/archive-usage` with filter dropdowns (subject, semester)
- Use existing Canvas-based chart pattern (bar chart: Archive GB by subject)
- No PII in any response — blob paths are metadata only

**Ask First:**
- Whether the new page should be a top-level nav item or a tab within Cumplimiento (Compliance)

**Never:**
- No changes to the lifecycle rules in `storage.bicep` (this is read-only metrics)
- No additional storage tables or schemas
- No charting libraries (use Canvas API as existing Dashboard.js)
- No Pagination beyond Azure continuation token

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Archive tier has data | Containers have blobs in Archive + Hot tiers | `{ totalArchiveBlobs: 42, totalArchiveSizeGB: 2.3, bySubject: [...], bySemester: [...], lastUpdatedAt: "..." }` | N/A |
| No blobs in Archive | All blobs are Hot/Cool tier | `{ totalArchiveBlobs: 0, totalArchiveSizeGB: 0, bySubject: [], bySemester: [] }` | N/A |
| Container doesn't exist | Container not yet provisioned | `{ totalArchiveBlobs: 0, totalArchiveSizeGB: 0, bySubject: [], note: "Container not found" }` | Graceful skip |
| Filter by subjectId | `?subjectId=arq-software` | Only archive blobs from that subject | Empty arrays if none |
| Filter by semester | `?semester=2026-1` | Only archive blobs with that semester prefix | Empty arrays if none |
| Subject not in Archive | Filter for subject with no archived blobs | `{ totalArchiveBlobs: 0, ... }` for that filter | Empty arrays |

</frozen-after-approval>

## Code Map

- `backend/src/services/archive-usage.js` — New service: enumerate containers, group by tier+subject+semester, aggregate counts/sizes
- `backend/src/functions/archive-usage.js` — New Function: `GET /api/archive-usage` with Director role guard and query filters
- `backend/src/index.js` — Register archive-usage function import
- `frontend/src/services/api.js` — Add `getArchiveUsage(subjectId?, semester?)` method with mock
- `frontend/src/pages/director/ArchiveUsage.js` — New director page: archive KPI cards, bar chart, filter controls, data source note
- `frontend/src/main.js` — Register route `/director/archive-usage`
- `frontend/src/components/Sidebar.js` — Add nav entry to director section

## Tasks & Acceptance

**Execution:**
- [x] `backend/src/services/archive-usage.js` — Build `getArchiveUsage({ subjectId?, semester? })` scanning class-materials + processed containers; group Archive blobs by inferred subjectId and semester; return aggregated counts + GB
- [x] `backend/src/functions/archive-usage.js` — HTTP GET handler with Director role guard; accept query params subjectId and semester; delegate to service
- [x] `backend/src/index.js` — Add import for archive-usage function
- [x] `frontend/src/services/api.js` — Add `getArchiveUsage()` with mock returning zero-state data
- [x] `frontend/src/pages/director/ArchiveUsage.js` — Render KPI cards (Archive blob count, total GB), bar chart (GB by subject), filter dropdowns (subject, semester), last-updated timestamp + data source note
- [x] `frontend/src/main.js` — Register `/director/archive-usage` route
- [x] `frontend/src/components/Sidebar.js` — Add "Archivo en Frío" nav item to director section

**Acceptance Criteria:**
- Given I am a Director, when I navigate to `#/director/archive-usage`, then I see KPI cards with Archive blob count and total size in GB
- Given Archive blobs exist, when the page loads, then a bar chart shows Archive GB broken down by subject
- Given I select a subject filter, when the filter changes, then the data refreshes to show only that subject's archive blobs
- Given I select a semester filter, when the filter changes, then the data refreshes to show only that semester's archive blobs
- Given no Archive blobs exist, when the page loads, then zero-state is shown with note "Sin datos de archivo en frío"
- Given the API returns data, when the page renders, then `lastUpdatedAt` and a data source note are displayed

## Design Notes

SubjectId is inferred from the blob path. Example path:
`class-materials/semester-2026-1/class-03/transcript/abc-123.txt`
→ `subjectId` cannot be inferred from the path alone (it's not in the path). However, looking at the existing `materials` Table Storage table, each material record has `subjectId`, `classId`, and `blobUrl`. So we can cross-reference blobs with the `materials` table to map blobs to subjects.

Alternative: Read `classId` from path and join with `classes` table. But the simplest approach for MVP is to parse the path for classId, then query the `materials` Table Storage table (PartitionKey=classId) to get `subjectId`.

Actually, looking at existing patterns in `storage-lifecycle.js`, it only uses prefix matching, not subject resolution. For the MVP, since we need subject breakdown, we have two options:
1. Scan `materials` table to build a classId→subjectId map (efficient, one table query)
2. Parse path and join with classes table

**Decision:** Use the `materials` Table Storage table. Query all materials (or filter by classId prefix). Build a map. This avoids per-blob table lookups.

## Verification

- `npm run lint` in both `frontend/` and `backend/` directories
- Manual: visit `#/director/archive-usage` in the browser after deployment
- `curl -H "X-MS-CLIENT-PRINCIPAL: ..." $SWA_URL/api/archive-usage` to test API
