---
baseline_commit: 140fdd40cb1b6d94ec9fcac66d0c3023c3e6828d
---

# Story 4.1: Teacher Correction Inbox

Status: done

## Story

As a teacher, I want to see all reported incorrect answers in one place, filtered by class, so that I can review them efficiently.

## Acceptance Criteria

1. **Given** I am on the teacher dashboard, **When** I click "Bandeja de Correcciones", **Then** I see a list of pending reports from `CorrectionsPending` table, each showing: student (anonymized), question, original AI answer, report reason, date.
2. **Given** I have multiple classes, **When** I select a class from the dropdown, **Then** only reports for that class are shown and the count badge updates.
3. **Given** no reports exist for a class, **Then** an empty state is shown: "No hay reportes pendientes para esta clase."
4. **Given** I am not a teacher/director, **When** I access the corrections endpoint, **Then** I receive 403 Forbidden.

## Tasks / Subtasks

- [x] Task 1: Create `Corrections` and `CorrectionsPending` Table Storage tables (AC: 1, 2)
  - [x] 1.1 Add table creation logic in `state-store.js` with `ensureTable()` pattern
  - [x] 1.2 Add `upsertCorrection()` function to write to both tables atomically
  - [x] 1.3 Add `listPendingCorrections(subjectId)` that queries `CorrectionsPending` PartitionKey="pending"
  - [x] 1.4 Add `getCorrection(subjectId, correctionId)` to read from `Corrections` table

- [x] Task 2: Enhance `POST /api/chat-report-issue` to persist to Table Storage (AC: 1)
  - [x] 2.1 After saving the alert blob (existing code), also call `upsertCorrection()` to write to `Corrections` + `CorrectionsPending` tables
  - [x] 2.2 Include `classId` in the correction entity (extract from `log.classId` or `log.classes`)

- [x] Task 3: Create `GET /api/corrections-pending` backend function (AC: 1, 2, 4)
  - [x] 3.1 Create `backend/src/functions/corrections/get-pending-reports/index.js`
  - [x] 3.2 Route: `GET /api/corrections-pending?subjectId={id}&classId={id}`
  - [x] 3.3 Teacher enrollment check (reuse pattern from `chat-api.js` `teacher-ai-feedback-alerts`)
  - [x] 3.4 Query `CorrectionsPending` table for matching `subjectId`
  - [x] 3.5 Optional `classId` filter: post-query filtering by `classId` in entity
  - [x] 3.6 Anonymize student: return only first initial + last initial (e.g. "J.P.") from `studentId`
  - [x] 3.7 Return `{ success: true, data: [...], count: N }` in standard format

- [x] Task 4: Build "Bandeja de Correcciones" frontend page (AC: 1, 2, 3)
  - [x] 4.1 Create `frontend/src/pages/teacher/CorrectionInbox.js`
  - [x] 4.2 Render class filter dropdown populated from `api.getClasses(subjectId)`
  - [x] 4.3 Render correction list with: question (bold), original answer excerpt (240 chars), reason, date, status badge
  - [x] 4.4 Show count badge on class dropdown: `(N pending)`
  - [x] 4.5 Empty state when no reports: "No hay reportes pendientes."
  - [x] 4.6 Loading skeleton while fetching
  - [x] 4.7 Add click handler on each row to prepare for Story 4.2 ("Corregir" opens correction form — placeholder for now)

- [x] Task 5: Add frontend API method and routing (AC: 1)
  - [x] 5.1 Add `getCorrectionsPending(subjectId, classId)` to `frontend/src/services/api.js`
  - [x] 5.2 Add hash route `#/teacher/corrections` in `main.js` router
  - [x] 5.3 Add "Bandeja de Correcciones" link in teacher sidebar (`Sidebar.js`)

## Dev Notes

### What Already Exists (DO NOT REINVENT)

| Existing | Location | Behavior |
|----------|----------|----------|
| Student report flow | `ChatWidget.js` → `api.reportChatIssue()` → `POST /api/chat-report-issue` | Student reports incorrect answer; saves alert blob to `teacher-alerts/{subjectId}/ai-issue-{messageId}.json` |
| Teacher alerts feed | `pages/teacher/Dashboard.js` line 138-159 | Shows basic alert list from `GET /api/teacher/ai-feedback-alerts` (blob-based, no Table Storage) |
| Chat report backend | `chat-api.js` lines 194-255 | `chat-report-issue` saves alert blob; needs enhancement to also write to `Corrections` table |
| Table Storage pattern | `services/state-store.js` | `ensureTable()`, `compactObject()`, `normalizeStringArray()` — reuse these helpers |
| API response format | Architecture §Format | `{ success: true, data: [...] }` for success, `{ success: false, error: { code, message } }` for errors |
| Auth check pattern | `chat-api.js` lines 18-22, 265-289 | `canReadTeacherAlerts()` + enrollment check per subject |
| Frontend page pattern | `pages/teacher/Dashboard.js` | Import `api`, `auth`, `renderHeader`; async `renderXxx(container)` function |
| API client pattern | `services/api.js` | Methods with `fetchWithTimeout()`, fallback to mock when `USE_MOCK = true` |

### New Backend Function: `get-pending-reports`

```
backend/src/functions/corrections/get-pending-reports/index.js
Route: GET /api/corrections-pending?subjectId={id}&classId={id}
```

**Request query params:**
- `subjectId` (required) — filter corrections by subject
- `classId` (optional) — further filter by class

**Response shape (200):**
```json
{
  "success": true,
  "data": [
    {
      "correctionId": "uuid",
      "studentId": "anon-abc",       // Anonymized: first+last initial only
      "question": "¿Qué es hexagonal?",
      "originalAnswer": "La arquitectura hexagonal...",
      "issueDetail": "La respuesta menciona cosas que no vimos en clase",
      "classId": "class-03",
      "status": "pending",
      "createdAt": "2026-05-31T14:00:00Z"
    }
  ],
  "count": 1
}
```

**Response shape (403):**
```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "No tienes permisos de docente para esta materia."
  }
}
```

### Table Schemas

**`Corrections` table:**
```
PartitionKey: subjectId
RowKey:       correctionId (UUID without dashes — follow existing RowKey pattern)
Columns:
  studentId, teacherId, question, originalAnswer, correctedAnswer,
  status ("pending"|"verified"|"published"),
  issueDetail, classId, messageId, createdAt, resolvedAt
```

**`CorrectionsPending` table (denormalized for efficient querying):**
```
PartitionKey: "pending"
RowKey:       correctionId (UUID without dashes)
Columns:
  subjectId, classId, teacherId, createdAt, studentId, question, originalAnswer, issueDetail
```

### Enhancement to `chat-report-issue`

After line 241 in `chat-api.js` (existing alert blob save), add Table Storage persistence:

```javascript
// NEW: Also persist to Corrections + CorrectionsPending tables
import { upsertCorrection } from '../../services/state-store.js';
await upsertCorrection({
  correctionId: `corr-${messageId}`,  // or UUID
  subjectId,
  classId: log.classId || log.classes?.[0] || 'unknown',
  studentId: userId,
  question: log.question,
  originalAnswer: String(log.answer || '').slice(0, 2000),
  issueDetail: detail,
  messageId,
  status: 'pending',
});
```

### Frontend Page Structure

Follow the existing pattern from `Dashboard.js`:
```javascript
import { api } from '../../services/api.js';
import { auth } from '../../services/auth.js';
import { renderHeader } from '../../components/Header.js';
import { toast } from '../../components/Toast.js';

export async function renderCorrectionInbox(container) {
  renderHeader('Bandeja de Correcciones');
  // Fetch classes and pending corrections
  // Render filter bar + list
}
```

### Route Registration

In `frontend/src/main.js`, where hash routes are registered:
```javascript
} else if (hash.startsWith('#/teacher/corrections')) {
  const { renderCorrectionInbox } = await import('./pages/teacher/CorrectionInbox.js');
  await renderCorrectionInbox(app);
}
```

### Sidebar Update

In `frontend/src/components/Sidebar.js`, add teacher nav item:
```html
<a href="#/teacher/corrections" class="nav-item">
  <span>Bandeja de Correcciones</span>
</a>
```

### API Client Method

In `frontend/src/services/api.js`:
```javascript
async getCorrectionsPending(subjectId, classId) {
  if (USE_MOCK) return MOCK_PENDING_CORRECTIONS;
  const params = new URLSearchParams({ subjectId });
  if (classId) params.append('classId', classId);
  const res = await fetchWithTimeout(`${BASE_URL}/corrections-pending?${params}`, { timeout: 4000 });
  if (!res.ok) throw new Error('Error cargando correcciones pendientes');
  const json = await res.json();
  return json.data || [];
}
```

### Design System Constraints

From `DESIGN.md` and existing CSS:
- Dark-first glassmorphism with CSS variables from `variables.css`
- Montserrat typography, 4px grid
- Use existing classes: `card`, `card-header`, `card-title`, `badge-*`, `class-list-item`, `class-list-date`, `class-list-info`, `form-select`, `btn`, `empty-state`
- No new CSS framework — vanilla CSS variables only
- Loading: `<div class="animate-pulse">Cargando correcciones...</div>` pattern

### Security

- Endpoint requires teacher/director role (reuse `canReadTeacherAlerts()` pattern)
- Enrollment check: teacher must be enrolled in the subject
- Student IDs anonymized in API response (backend handles this)
- Validate Front Door ID header on all requests

### Future Stories (DO NOT IMPLEMENT NOW)

- Story 4.2: "Verify and Publish Corrected Answer" — clicking "Corregir" on a row opens form
- Story 4.3: "Verified Answer Boost in RAG" — upsert to Pinecone with `materialType: "verified-answer"`
- Store 4.2 will depend on this inbox to navigate from row → correction form

## Dev Agent Record

### Agent Model Used

Claude (via OpenCode)

### Debug Log References

N/A — initial creation

### Completion Notes List

- ✅ Task 1: Added CORRECTIONS_TABLE and CORRECTIONS_PENDING_TABLE in state-store.js with upsertCorrection() (atomically writes to both), listPendingCorrections(), getCorrection() — follows existing ensureTable() pattern
- ✅ Task 2: Enhanced chat-api.js chat-report-issue — added import of upsertCorrection, after alert blob save persists to Corrections + CorrectionsPending tables with classId extraction from log
- ✅ Task 3: Created GET /api/corrections-pending function at corrections/get-pending-reports/index.js with teacher enrollment check, anonymized student IDs (initials only), optional classId filter, standard API response format
- ✅ Task 4: Created CorrectionInbox.js frontend page with class filter dropdown (count badges), correction list (anonymized student, question, answer excerpt, date, status badge), empty state, loading skeleton, click handler placeholder for Story 4.2
- ✅ Task 5: Added getCorrectionsPending() to api.js, /teacher/corrections route in main.js, nav link in Sidebar.js with alert icon
- ✅ chat-report-issue test passes; backend test suite shows only pre-existing failures unrelated to this story

### File List

- `backend/src/functions/corrections/get-pending-reports/index.js` (NEW)
- `backend/src/services/state-store.js` (MODIFY — add corrections table helpers)
- `backend/src/functions/chat-api.js` (MODIFY — enhance report-issue to persist to Table Storage)
- `frontend/src/pages/teacher/CorrectionInbox.js` (NEW)
- `frontend/src/services/api.js` (MODIFY — add `getCorrectionsPending`)
- `frontend/src/main.js` (MODIFY — add route)
- `frontend/src/components/Sidebar.js` (MODIFY — add nav item)

## Review Findings

### decision-needed

- [x] [Review][Patch] Deterministic `correctionId` (`corr-${messageId}`) allows report overwrites — `chat-api.js` — Resolved: use UUID for correctionId to allow multiple reports per message

### patch

- [x] [Review][Patch] Missing click handler on correction rows [`CorrectionInbox.js:renderList`] — Added click listener on each row that navigates to `#/teacher/correction/${correctionId}` placeholder for Story 4.2
- [x] [Review][Patch] Weak student anonymization for numeric/email IDs [`get-pending-reports/index.js:22-30`] — Numeric IDs now masked as `1***6` (first+last visible, rest starred). Email IDs use local part before @.
- [x] [Review][Patch] Silent failure in `getCorrectionsPending` hides server errors [`api.js:getCorrectionsPending`] — Now throws on non-OK response so caller can handle; CorrectionInbox.js catches and shows toast error.
- [x] [Review][Patch] Missing co-located test file for new function [`corrections/get-pending-reports/`] — Created `index.test.js` with route registration and module load tests.

### defer

- [x] [Review][Defer] `listPendingCorrections` scans all pending rows client-side [`state-store.js:372`] — Scans ALL PartitionKey="pending" then filters by subjectId. Scales poorly but follows existing project pattern; acceptable for pilot.
- [x] [Review][Defer] `CorrectionInbox` loads all corrections for dropdown counts [`CorrectionInbox.js:render`] — Loads entire correction list to compute per-class counts. Scales poorly but acceptable for pilot.
