---
baseline_commit: 6ce5a7f
---

# Story 4.2: Verify and Publish Corrected Answer

Status: done

## Story

As a teacher, I want to provide a corrected answer for a reported response, so that students get accurate information.

## Acceptance Criteria

1. **Given** I am reviewing a report in my inbox, **When** I click "Corregir", **Then** a form appears with: original AI response (read-only), "Tu corrección" (textarea, required), "Explicación adicional" (textarea, optional), and "Publicar corrección" button.
2. **Given** I submit a correction, **When** the system processes it, **Then** the record in `Corrections` updates to status="verified", the corrected answer is upserted to Pinecone with `materialType: "verified-answer"`, and the correction is removed from `CorrectionsPending`.
3. **Given** a correction is published, **When** the flow completes, **Then** an in-app toast confirms success and the teacher is redirected back to the inbox.
4. **Given** I am not a teacher/director, **When** I access the verify endpoint, **Then** I receive 403 Forbidden.

## Tasks / Subtasks

- [x] Task 1: Create `POST /api/corrections-verify` backend function (AC: 2, 4)
  - [x] 1.1 Create `backend/src/functions/corrections/verify-answer/index.js`
  - [x] 1.2 Route: `POST /api/corrections-verify` with body `{ correctionId, subjectId, correctedAnswer, explanation }`
  - [x] 1.3 Teacher auth check (reuse `canReadTeacherAlerts` + enrollment pattern from `get-pending-reports`)
  - [x] 1.4 Fetch correction via `getCorrection(subjectId, correctionId)`, reject if not found or not pending
  - [x] 1.5 Update `Corrections` table via `upsertCorrection()`: status="verified", set `correctedAnswer`, `teacherId`, `resolvedAt`
  - [x] 1.6 Delete from `CorrectionsPending` table (via `deletePendingCorrection` helper)
  - [x] 1.7 Generate embedding for corrected answer using `text-embedding-3-small`
  - [x] 1.8 Upsert to Pinecone with `materialType: "verified-answer"` metadata (subjectId, classId, originalQuestion, teacherId)
  - [x] 1.9 Return `{ success: true, data: { correctionId, status: "verified" } }`

- [x] Task 2: Create `deletePendingCorrection` helper in state-store (AC: 2)
  - [x] 2.1 Add `deletePendingCorrection(correctionId)` function in `state-store.js`
  - [x] 2.2 Remove entity from `CorrectionsPending` table (PartitionKey="pending")

- [x] Task 3: Build correction detail form frontend page (AC: 1, 3)
  - [x] 3.1 Create `frontend/src/pages/teacher/CorrectionDetail.js`
  - [x] 3.2 Parse `correctionId` from hash: `#/teacher/correction/:correctionId`
  - [x] 3.3 Fetch correction via existing `getCorrection()` API method (filters client-side by correctionId)
  - [x] 3.4 Render form: original question (read-only), AI answer (read-only in a styled box), "Tu corrección" textarea (required, min 10 chars), "Explicación adicional" textarea (optional), "Publicar corrección" button
  - [x] 3.5 Add "Cancelar" button that navigates back to `#/teacher/corrections`
  - [x] 3.6 On submit: call `api.verifyAnswer({ correctionId, subjectId, correctedAnswer, explanation })`
  - [x] 3.7 On success: show toast "Corrección publicada. El alumno recibirá tu respuesta verificada.", redirect to inbox
  - [x] 3.8 On error: show toast with error message, keep form state
  - [x] 3.9 Loading state while fetching correction and while submitting

- [x] Task 4: Add frontend API method and routing (AC: 1, 3)
  - [x] 4.1 Add `verifyAnswer(payload)` to `frontend/src/services/api.js`
  - [x] 4.2 Add `getCorrection(subjectId, correctionId)` to `frontend/src/services/api.js`
  - [x] 4.3 Add dynamic hash route `#/teacher/correction/*` in `main.js` router
  - [x] 4.4 CorrectionInbox.js click handler already wired in 4.1 — no change needed

## Dev Notes

### What Already Exists (DO NOT REINVENT)

| Existing | Location | Behavior |
|----------|----------|----------|
| Correction inbox | `pages/teacher/CorrectionInbox.js` | List of pending corrections; click handler navigates to `#/teacher/correction/${correctionId}` (line 136) |
| Table Storage helpers | `services/state-store.js:382-426` | `upsertCorrection()`, `getCorrection()`, `listPendingCorrections()` — all with ensureTable |
| Correction entity schema | `state-store.js:311-379` | `toCorrectionEntity`, `fromCorrectionEntity`, `toCorrectionPendingEntity` |
| Chat report flow | `chat-api.js:196-274` | `chat-report-issue` persists to `Corrections` + `CorrectionsPending` tables |
| Pinecone upsert | `services/vector-store.js:140-165` | `upsertVectors(vectors)` — accepts array of `{ id, values, metadata }` |
| Embedding generation | `services/ai.js` | `generateEmbedding(text)` — returns 1536-dim vector |
| Auth check | `get-pending-reports/index.js:5-9` | `canReadTeacherAlerts(principal)` — reuse verbatim |
| Enrollment check | `get-pending-reports/index.js:77-100` | `getEnrollment(subjectId, userId)` with role="teacher" — reuse verbatim |
| API response format | Architecture §Format | `{ success, data, error, meta }` for all endpoints |
| Auth utils | `services/auth-utils.js` | `validateFrontDoorId()`, `parseClientPrincipal()` |
| Frontend page pattern | `pages/teacher/CorrectionInbox.js` | Import `api`, `auth`, `renderHeader`, `toast`; async `renderXxx(container)` |
| Frontend toast | `components/Toast.js` | `toast('success', title, message)` |

### New Backend Function: `verify-answer`

```
backend/src/functions/corrections/verify-answer/index.js
Route: POST /api/corrections-verify
```

**Request body:**
```json
{
  "correctionId": "abc123...",
  "subjectId": "arq-software-2026",
  "correctedAnswer": "La arquitectura hexagonal es...",
  "explanation": "Detalle adicional opcional"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": { "correctionId": "abc123...", "status": "verified" },
  "meta": { "timestamp": "2026-05-31T14:00:00Z", "requestId": "..." }
}
```

**Pipeline within the function:**
1. Validate auth (Front Door ID + teacher role + enrollment)
2. Parse body, validate required fields (correctionId, subjectId, correctedAnswer)
3. `getCorrection(subjectId, correctionId)` — reject if not found or status !== "pending"
4. Update correction: set `correctedAnswer`, `teacherId=userId`, `status="verified"`, `resolvedAt=now`
5. `upsertCorrection(updatedEntity)` — overwrites existing in `Corrections`
6. Delete from `CorrectionsPending` table: `deleteEntity("pending", correctionId)`
7. Generate embedding: `generateEmbedding(correctedAnswer)` → 1536-dim vector
8. Upsert to Pinecone:
```javascript
import { upsertVectors } from '../../services/vector-store.js';
import { generateEmbedding } from '../../services/ai.js';

const vector = await generateEmbedding(correctedAnswer);
await upsertVectors([{
  id: `verified-${correctionId}`,
  values: vector,
  metadata: {
    materialType: 'verified-answer',
    subjectId,
    classId: correction.classId,
    originalQuestion: correction.question,
    teacherId: userId,
    sourceFilename: `correction-${correctionId}`,
    lectureDate: new Date().toISOString().slice(0, 10),
    chunkIndex: 0,
    materialId: `corr-${correctionId}`,
  }
}]);
```

### New state-store helper: `deletePendingCorrection`

In `backend/src/services/state-store.js`, add:

```javascript
export async function deletePendingCorrection(correctionId) {
  if (!correctionId) return;
  await ensureTable(CORRECTIONS_PENDING_TABLE);
  const client = getTableClient(CORRECTIONS_PENDING_TABLE);
  try {
    await client.deleteEntity('pending', correctionId);
  } catch (err) {
    if (err.statusCode !== 404) throw err;
  }
}
```

**Import to add** in verify-answer/index.js:
```javascript
import { deletePendingCorrection } from '../../services/state-store.js';
```

### Frontend Page Structure

Follow the pattern from `CorrectionInbox.js`:
```javascript
import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';
import { toast } from '../../components/Toast.js';

export async function renderCorrectionDetail(container) {
  renderHeader('Corregir Respuesta');
  const correctionId = window.location.hash.split('/').pop()?.split('?')[0];
  // ...
}
```

**Form layout:**
```
┌─────────────────────────────────────────┐
│ ← Volver a la bandeja                    │
│                                          │
│ Pregunta del alumno:                     │
│ "¿Qué es la arquitectura hexagonal?"     │
│                                          │
│ Respuesta original de la IA:             │
│ ┌─────────────────────────────────────┐  │
│ │ La arquitectura hexagonal es un     │  │
│ │ patrón que... (read-only box)       │  │
│ └─────────────────────────────────────┘  │
│                                          │
│ Tu corrección *:                         │
│ ┌─────────────────────────────────────┐  │
│ │ (textarea, required, min 10 chars)  │  │
│ └─────────────────────────────────────┘  │
│                                          │
│ Explicación adicional (opcional):        │
│ ┌─────────────────────────────────────┐  │
│ │ (textarea, optional)                │  │
│ └─────────────────────────────────────┘  │
│                                          │
│ [Cancelar]  [Publicar Corrección]        │
└─────────────────────────────────────────┘
```

### Route Registration

In `frontend/src/main.js`, add dynamic route matching for `#/teacher/correction/*`:

```javascript
// In handleRoute(), after the existing /student/class/ handler:
if (fullPath.startsWith('/teacher/correction/')) {
    matchedPath = '/teacher/correction';
}
```

In `ROUTES`:
```javascript
'/teacher/correction': () => import('./pages/teacher/CorrectionDetail.js').then(m => m.renderCorrectionDetail),
```

### API Client Methods

In `frontend/src/services/api.js`:

```javascript
async verifyAnswer(payload) {
  const res = await apiFetch(`${BASE_URL}/corrections-verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let message = 'Error al publicar corrección';
    try { const err = await res.json(); if (err?.error?.message) message = err.error.message; } catch {}
    throw new Error(message);
  }
  return res.json();
},

async getCorrection(subjectId, correctionId) {
  if (USE_MOCK) {
    await delay(300);
    return {
      correctionId,
      studentId: 'J.P.',
      question: '¿Qué es la arquitectura hexagonal?',
      originalAnswer: 'La arquitectura hexagonal es un patrón de diseño de software...',
      issueDetail: 'La respuesta no menciona puertos y adaptadores',
      classId: 'class-03',
      status: 'pending',
      createdAt: '2026-05-31T10:00:00Z',
    };
  }
  const params = new URLSearchParams({ subjectId });
  if (correctionId) params.append('correctionId', correctionId);
  const res = await fetchWithTimeout(`${BASE_URL}/corrections-pending?${params}`, { timeout: 4000 });
  if (!res.ok) throw new Error('Error cargando corrección');
  const json = await res.json();
  const data = json.data || [];
  return correctionId ? data.find(c => c.correctionId === correctionId) || null : data;
},
```

Note: The `getCorrection` method reuses the existing `corrections-pending` endpoint and filters client-side. If there's a dedicated `GET /api/corrections/{id}` endpoint in the future, update this.

### CorrectionInbox.js Update

The click handler at line 133-139 already navigates to `#/teacher/correction/${correctionId}`. No changes needed — it's already wired for Story 4.2.

### Design System Constraints

From existing CSS and `DESIGN.md`:
- Dark-first glassmorphism with CSS variables from `variables.css`
- Montserrat typography, 4px grid
- Use existing classes: `card`, `card-header`, `card-title`, `form-select`, `btn`, `btn-primary`, `btn-secondary`, `empty-state`
- Read-only box: `--surface-2` background, `--radius-md`, padding `var(--space-4)`, subtle border `--border-subtle`
- Textarea styling: follow existing `.form-select` / `.form-input` patterns
- Required field indicator: red asterisk after label
- Loading: `<div class="animate-pulse">Cargando...</div>` pattern
- Validation error: red border + error text below field

### Security

- Endpoint requires teacher/director role (reuse `canReadTeacherAlerts()` pattern from `get-pending-reports/index.js`)
- Enrollment check: teacher must be enrolled in the subject
- Validate Front Door ID header on all requests
- Only allow verification if correction.status === "pending"
- Teacher ID from authenticated principal (not from request body)

### Error Handling

| Scenario | Response |
|----------|----------|
| Missing required fields | 400 — `{ success: false, error: { code: "INVALID_INPUT", message: "Faltan campos requeridos." } }` |
| Not a teacher/director | 403 — `{ success: false, error: { code: "FORBIDDEN", message: "..." } }` |
| Correction not found | 404 — `{ success: false, error: { code: "NOT_FOUND", message: "Corrección no encontrada." } }` |
| Correction already verified | 409 — `{ success: false, error: { code: "ALREADY_VERIFIED", message: "Esta corrección ya fue verificada." } }` |
| Pinecone/embedding failure | 500 — `{ success: false, error: { code: "INTERNAL_ERROR", message: "Error publicando corrección. Intentá de nuevo." } }` |

### Notification Strategy (Do NOT over-engineer)

Graph API Teams notifications are the architectural target but the `graph-client.js` service does not yet exist in the codebase. For this story:
- **DO:** Show in-app toast on success (already handled in frontend task 3.7)
- **DO:** Log the verification event in App Insights: `context.log({ name: "Correction.Verified", properties: { correctionId, subjectId, teacherId, studentId } })`
- **DO NOT:** Implement Graph API integration in this story (that's a separate concern — the architecture already defines notification work in Epic 5)
- The student notification requirement (Teams message) is deferred to when Graph API client is available

### Previous Story Learnings (4.1)

- `correctionId` uses UUID without dashes (RowKey pattern for Table Storage)
- Student anonymization handled by backend (`anonymizeStudentId` function)
- `listPendingCorrections` scans all pending rows then filters by subjectId — acceptable for pilot scale
- Click handler on correction rows already implemented in 4.1 with placeholder route
- Frontend API client uses `fetchWithTimeout()` with timeout values; never raw fetch
- Design system: all colors via CSS variables, no hardcoded values

### Future Stories (DO NOT IMPLEMENT NOW)

- Story 4.3: "Verified Answer Boost in RAG" — RAG pipeline queries `materialType: "verified-answer"` first with score boost
- Full Graph API notification integration (Epic 5 scope)
- Correction deletion/undo functionality

### Project Context Reference

- See `project-context.md` §§3-5 for data models, API contracts, and implementation rules
- Pinecone metadata interface: `PineconeMetadata` — ensure all fields are populated
- Chunking: 512 tokens, 50 overlap (verified answers are single-chunk, no splitting needed)
- `context.log()` for all logging, never `console.log()`
- Dates: ISO 8601 UTC with explicit `Z`
- UUID v4 without dashes for Table Storage RowKey, with dashes in JSON

## Dev Agent Record

### Agent Model Used

opencode/deepseek-v4-flash-free

### Debug Log References

### Completion Notes List

- ✅ Task 2: Added `deletePendingCorrection(correctionId)` to state-store.js — deletes entity from CorrectionsPending table by PartitionKey="pending", gracefully handles 404
- ✅ Task 1: Created `POST /api/corrections-verify` at `corrections/verify-answer/index.js` — full pipeline: teacher auth, enrollment check, correction lookup, status validation, table update, pending deletion, embedding generation (generateEmbedding), Pinecone upsert (upsertChunks) with `materialType: "verified-answer"`, standard API response
- ✅ Task 4: Added `verifyAnswer(payload)` and `getCorrection(subjectId, correctionId)` to `api.js` — both with mock fallbacks; added dynamic route `#/teacher/correction/*` in `main.js` router (matched in handleRoute + ROUTES map)
- ✅ Task 3: Created `CorrectionDetail.js` — parses correctionId from hash, fetches correction via getCorrection(), renders form with original question, AI answer (read-only box), correction textarea (required, min 10 chars validation), explanation textarea (optional), submit/cancel buttons. Toast on success redirects to inbox. Loading + error states handled.
- ✅ 5 unit tests pass for verify-answer (module load, role check, status check, field validation, not-found)
- ✅ State-store tests pass (3/3, no regressions)
- CorrectionInbox.js click handler was already wired in 4.1 — no change needed

### Code Review Fixes Applied

Three-layer code review completed. All findings fixed:

- ✅ **Critical (Race Condition):** After `upsertCorrection`, re-read correction from table and verify `teacherId === userId` before proceeding to Pinecone upsert. Returns 200 on race (safe) without duplicating embeddings.
- ✅ **High (Partial Failure):** Wrapped Pinecone `upsertChunks` in dedicated try-catch with `PINECONE_UPSERT_FAILED` error code and compensating log message for manual reconciliation.
- ✅ **High (Missing Persistence):** Added `explanation` field to `toCorrectionEntity` and `fromCorrectionEntity` in state-store.js so it round-trips through the Corrections table.
- ✅ **Medium (Explanation Validation):** Backend validates `explanation` type (`string`) and max length (5000 chars) before processing. Returns 400 with `INVALID_INPUT` code.
- ✅ **Medium (Explanation Length):** Frontend `<textarea>` has `maxlength="5000"` matching backend limit.
- ✅ **Medium (lectureDate Format):** Pinecone metadata uses `now` (full ISO 8601 datetime) instead of `now.slice(0, 10)` for accurate date filtering.
- ✅ **Low (Button Type):** Submit button has `type="button"` to prevent accidental form submission inside a `<div>` container.
- ✅ **Low (Double Submit):** Added `isSubmitting` flag in click handler — early returns on duplicate clicks and resets on error (so user can retry).

### Change Log

- 2026-06-18: All tasks completed. Code review fixes applied. Status updated review → done.

### File List

- `backend/src/functions/corrections/verify-answer/index.js` (NEW)
- `backend/src/functions/corrections/verify-answer/index.test.js` (NEW)
- `backend/src/services/state-store.js` (MODIFY — add `deletePendingCorrection`, add `explanation` to entity mappers)
- `frontend/src/pages/teacher/CorrectionDetail.js` (NEW)
- `frontend/src/services/api.js` (MODIFY — add `verifyAnswer`, `getCorrection`)
- `frontend/src/main.js` (MODIFY — add `/teacher/correction` route)
