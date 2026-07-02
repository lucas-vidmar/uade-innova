# Story 1.1b: Enrollment Validation

Status: done

## Story

As a student,
I want the system to verify I'm enrolled in a subject before accessing its chat,
so that I only see materials for subjects I'm actually taking.

## Acceptance Criteria

### AC1: Enrolled Student Access
**Given** I am authenticated via Entra ID
**When** I attempt to open the chat for a subject
**Then** the system queries the `Enrollments` table (PartitionKey=subjectId, RowKey=myUserId)
**And** allows access only if a record exists with status="active"

### AC2: Unenrolled Student Blocked
**Given** I am not enrolled in a subject
**When** I try to access its chat
**Then** the API returns 403 Forbidden
**And** the UI shows: "No estás matriculado en esta materia. Contactá a administración."

### AC3: Teacher Always Has Access
**Given** I am authenticated as a teacher with an `Enrollments` record for the subject (role="teacher")
**When** I access the teacher dashboard for that subject
**Then** I can see and manage all materials without enrollment restriction

### AC4: Enrollment Data Seed
**Given** the `Enrollments` table is seeded with pilot data (mock CSV)
**When** a student or teacher logs in
**Then** their enrollment records are available from the `Enrollments` table for subject-to-role mapping

### AC5: Subject List Filtering
**Given** I am a student
**When** the subject list loads
**Then** I only see subjects where I have an active enrollment (status="active")

### AC6: Teacher Sees All Assigned Subjects
**Given** I am a teacher
**When** the subject list loads
**Then** I see only subjects where I have an enrollment record with role="teacher"

## Tasks / Subtasks

- [ ] Task 1: Create Enrollments Table Storage schema and seed script (AC: #4)
  - [ ] 1.1 Add `Enrollments` table to `infra/modules/storage.bicep` with schema: PartitionKey=subjectId, RowKey=userId, columns: role (student|teacher), enrolledAt, status
  - [ ] 1.2 Add `AZURE_STORAGE_ENROLLMENTS_TABLE` environment variable to `local.settings.json` and Function App settings
  - [ ] 1.3 Create `scripts/seed-enrollments.js` to bulk-insert enrollment records from a CSV file (`scripts/pilot-enrollments.csv`)
  - [ ] 1.4 Create `scripts/pilot-enrollments.csv` with mock pilot data mapping students/teachers to subjects
  - [ ] 1.5 Add `enrollmentsTable` binding to `backend/src/services/storage.js` — add helper `getTableClient('Enrollments')`

- [ ] Task 2: Create Backend Enrollment API (AC: #1, #2, #3)
  - [ ] 2.1 Create `backend/src/functions/enrollments-api.js` with four endpoints:
  - [ ] 2.1a `GET /api/enrollments?userId={userId}` — returns all enrollments for a user (checks PartitionKey scan or RowKey filter)
  - [ ] 2.1b `GET /api/enrollments/check?userId={userId}&subjectId={subjectId}` — returns `{ enrolled: true/false, role: "student"|"teacher" }` 
  - [ ] 2.1c `POST /api/enrollments` — creates or updates an enrollment record (teacher/director only)
  - [ ] 2.1d `DELETE /api/enrollments?userId={userId}&subjectId={subjectId}` — removes enrollment (director only)
  - [ ] 2.2 Add enrollment check to `rag-query` and `chat-api` functions — return 403 if user not enrolled
  - [ ] 2.3 Add enrollment filtering to `get-subjects` endpoint — filter returned subjects by user enrollment

- [ ] Task 3: Create Frontend Enrollment Service (AC: #5, #6)
  - [ ] 3.1 Create `frontend/src/services/enrollments.js`:
  - [ ] 3.1a `fetchMyEnrollments()` — calls `GET /api/enrollments?userId={userId}`, returns array of `{ subjectId, role, status }`
  - [ ] 3.1b `checkEnrollment(subjectId)` — calls `GET /api/enrollments/check?userId={userId}&subjectId={subjectId}`
  - [ ] 3.1c Caches enrollments in `sessionStorage` with key `uade.enrollments` (expires on session end)
  - [ ] 3.2 Update `frontend/src/services/auth.js` — after `initAuth()`, call `fetchMyEnrollments()` and store results
  - [ ] 3.3 Modify subject list rendering — filter subjects to only those where user has enrollment with `status="active"`

- [ ] Task 4: Enforce Access Control in Chat (AC: #1, #2)
  - [ ] 4.1 In `frontend/src/pages/student/ChatPage.js` (or equivalent chat entry point), check enrollment before allowing chat
  - [ ] 4.2 Show "No estás matriculado en esta materia. Contactá a administración." message when 403 is returned
  - [ ] 4.3 Disable chat input and show explanatory message when not enrolled

- [ ] Task 5: Update Auth Service with Enrollment Data (AC: #3, #5, #6)
  - [ ] 5.1 Update `frontend/src/services/auth.js` `getUser()` to include enrollment data from cache
  - [ ] 5.2 Add `getEnrolledSubjects()` method that returns filtered subject list
  - [ ] 5.3 Add `isEnrolled(subjectId)` convenience method
  - [ ] 5.4 Update `frontend/src/main.js` to load enrollments during bootstrap after auth init

- [ ] Task 6: Backend Tests (AC: All)
  - [ ] 6.1 Create `backend/src/functions/enrollments-api.test.js` with tests for:
  - [ ] 6.1a Enrollment check returns true for enrolled student
  - [ ] 6.1b Enrollment check returns false for unenrolled student
  - [ ] 6.1c Teacher enrollment returns role="teacher"
  - [ ] 6.1d POST enrollment requires teacher/director role
  - [ ] 6.1e DELETE enrollment requires director role
  - [ ] 6.1f Subject list filters by enrollment

- [ ] Task 7: Deploy and Verify (AC: All)
  - [ ] 7.1 Run `azd deploy` after code changes
  - [ ] 7.2 Run `scripts/seed-enrollments.js` against deployed storage
  - [ ] 7.3 Verify student can only access enrolled subjects
  - [ ] 7.4 Verify teacher sees only assigned subjects
  - [ ] 7.5 Verify unenrolled student gets 403 with correct message

## Dev Notes

### EXISTING CODE — DO NOT REWRITE FROM SCRATCH

This is a **BROWNFIELD** project with existing auth and subject code that MUST be extended:

**`frontend/src/services/auth.js`** — Already has:
- `initAuth()` that calls `/.auth/me` and parses `clientPrincipal` ✓
- Role mapping: `isDocente` → teacher, `isDirector` → director ✓
- Mock user system with role selection ✓
- `getRole()`, `setRole()`, `getActiveSubjectId()` ✓
- Subject sync from API: `api.getSubjects()` in `initAuth()` ✓

**Issues to FIX (not rewrite):**
1. `isAuthenticated()` currently returns `isDev` (always true in dev) — this is intentional for dev mode but needs enrollment check added alongside
2. Subject list from `api.getSubjects()` already filters by group membership for students (`groups.includes(s.group)`) — enrollment table must supplement/replace this
3. No enrollment table exists yet — need to create `Enrollments` Table Storage

**`backend/src/services/auth-utils.js`** — Already has:
- `parseClientPrincipal()` that reads `x-ms-client-principal` header ✓
- `getAuthenticatedUser()` that returns `{ userId, sanitizedId, principal, role }` ✓
- Mock role fallback via `x-mock-role` header ✓

**Issues to FIX:**
1. No enrollment validation exists in any backend function — need to add it
2. `get-subjects` already does group-based filtering but doesn't check `Enrollments` table

**`backend/src/functions/classes-api.js`** — Already has:
- `get-subjects` endpoint with group-based filtering for students ✓
- `parseClientPrincipal` used for role-based access ✓

**Issues to FIX:**
1. `get-subjects` filters by Microsoft 365 group membership, NOT by `Enrollments` table — both must work, with `Enrollments` as the primary filter

**`frontend/src/services/api.js`** — Already has:
- HTTP client with base URL and correlation headers ✓
- All existing API calls ✓

**`backend/src/services/storage.js`** — Already has:
- `getTableClient()` helper for Azure Table Storage ✓

### Architecture Compliance

- **Storage:** Azure Table Storage within existing Storage Account — new `Enrollments` table
- **API pattern:** New file `enrollments-api.js` following existing pattern (kebab-case, one function per endpoint)
- **API response format:** `{ success, data, error, meta }` with `error.code` in UPPER_SNAKE_CASE
- **Naming:** Table name `Enrollments` (PascalCase, per architecture), API function folder `enrollments-api` (kebab-case)
- **Auth:** API Keys via env vars, no Managed Identities (per AGENTS.md constraint)
- **Error handling:** `context.log()` with `userId`/`subjectId` context in every catch block
- **Table Storage schema:** PartitionKey=`subjectId`, RowKey=`userId`, columns: `role` (student|teacher), `enrolledAt` (ISO 8601), `status` (active|inactive)

### Data Model: Enrollments Table

```typescript
// Table Storage entity
interface EnrollmentEntity {
  partitionKey: string;  // subjectId (e.g., "arq-software-2026")
  rowKey: string;       // userId (from clientPrincipal.userId or oid)
  role: "student" | "teacher";
  enrolledAt: string;   // ISO 8601 date
  status: "active" | "inactive";
}
```

### API Endpoints

**GET `/api/enrollments?userId={userId}`**
Returns all enrollment records for a given user.

```json
{
  "success": true,
  "data": [
    { "subjectId": "arq-software-2026", "role": "student", "status": "active", "enrolledAt": "2026-03-01T00:00:00Z" },
    { "subjectId": "diseno-sistemas-2026", "role": "student", "status": "active", "enrolledAt": "2026-03-01T00:00:00Z" }
  ],
  "meta": { "timestamp": "2026-05-10T14:00:00Z" }
}
```

**GET `/api/enrollments/check?userId={userId}&subjectId={subjectId}`**
Returns enrollment status for a specific user-subject pair.

```json
{
  "success": true,
  "data": { "enrolled": true, "role": "student", "status": "active" }
}
```
or
```json
{
  "success": true,
  "data": { "enrolled": false, "role": null, "status": null }
}
```

**POST `/api/enrollments`** (teacher/director only)
Creates or updates an enrollment.

```json
// Request
{ "userId": "alu-001", "subjectId": "arq-software-2026", "role": "student", "status": "active" }

// Response
{ "success": true, "data": { "subjectId": "arq-software-2026", "userId": "alu-001", "role": "student", "status": "active" } }
```

**DELETE `/api/enrollments?userId={userId}&subjectId={subjectId}`** (director only)

```json
{ "success": true, "data": { "deleted": true } }
```

### Enrollment Filtering Logic

**Frontend (auth.js → enrollments.js):**
1. After `initAuth()`, call `GET /api/enrollments?userId={userId}`
2. Cache result in `sessionStorage` as `uade.enrollments` (JSON array)
3. Modify subject list rendering to intersect API subjects with enrolled subject IDs
4. A student sees ONLY subjects where `enrollment.status === "active"`
5. A teacher sees ONLY subjects where `enrollment.role === "teacher"`

**Backend (get-subjects endpoint):**
1. Continue existing group-based filtering as fallback
2. If `Enrollments` table has records for the user, use those as primary filter
3. If no enrollment records exist (pilot migration period), fall back to group-based filtering
4. This ensures backward compatibility during migration

### Enrollment Check Before Chat

In `rag-query.js` and `chat-api.js`:
```javascript
// Add at the top of handler, after auth check
const enrollment = await checkEnrollment(userId, subjectId);
if (!enrollment.enrolled || enrollment.status !== 'active') {
    return {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            success: false,
            error: {
                code: 'ENROLLMENT_REQUIRED',
                message: 'No estás matriculado en esta materia. Contactá a administración.'
            }
        })
    };
}
```

### Mock Enrollment Data (Pilot)

The seed CSV should include:
- All 65 pilot students enrolled in relevant subjects
- Teachers assigned to their respective subjects
- Status "active" by default

Example `scripts/pilot-enrollments.csv`:
```csv
subjectId,userId,role,status,enrolledAt
arq-software-2026,student-001,student,active,2026-03-15T00:00:00Z
arq-software-2026,student-002,student,active,2026-03-15T00:00:00Z
arq-software-2026,teacher-001,teacher,active,2026-03-10T00:00:00Z
diseno-sistemas-2026,student-001,student,active,2026-03-15T00:00:00Z
diseno-sistemas-2026,teacher-002,teacher,active,2026-03-10T00:00:00Z
```

### Relationship to Story 1.1a (Entra ID SSO)

Story 1.1a is **blocked** pending UADE Entra ID configuration. However, Story 1.1b can be developed and tested **independently** because:

1. The mock user system in `auth.js` provides `userId` values (`alu-001`, `doc-001`, `dir-001`)
2. The backend mock mode uses `x-mock-role` header for auth
3. Enrollment records use `userId` as the RowKey, which works with both mock IDs and real Entra ID OIDs
4. When Story 1.1a is unblocked, enrollment data will automatically map to real user IDs

**Dev mode mock IDs to use for seed data:**
- Students: `alu-001`, `alu-002`, etc. (matching `USERS.student.id` in auth.js)
- Teachers: `doc-001` (matching `USERS.teacher.id`)
- Director: `dir-001` (matching `USERS.director.id`)

### Security Considerations

- `Enrollments` table uses `userId` as RowKey — must match the canonical user ID from auth (`clientPrincipal.userId` or `oid`)
- POST/DELETE enrollment endpoints must check that caller has teacher or director role
- Enrollment check in `rag-query` must use authenticated `userId`, not a user-supplied parameter
- Dev mode: mock enrollments cached in `sessionStorage` must be refreshed on each login
- Production: enrollment data comes from `Enrollments` Table Storage, never from client-side cache alone

### Project Structure Notes

- New file: `backend/src/functions/enrollments-api.js` (NEW)
- New file: `backend/src/functions/enrollments-api.test.js` (NEW)
- New file: `scripts/seed-enrollments.js` (NEW)
- New file: `scripts/pilot-enrollments.csv` (NEW)
- UPDATE file: `frontend/src/services/auth.js` — Add enrollment loading and subject filtering
- UPDATE file: `frontend/src/services/api.js` — Add enrollment API methods
- UPDATE file: `frontend/src/main.js` — Load enrollments during bootstrap
- UPDATE file: `backend/src/functions/classes-api.js` — Add enrollment-based subject filtering
- UPDATE file: `backend/src/functions/rag-query.js` — Add enrollment check before processing queries
- UPDATE file: `backend/src/functions/chat-api.js` — Add enrollment check before processing chat messages
- UPDATE file: `backend/src/services/storage.js` — Add `enrollmentsTable` binding
- UPDATE file: `infra/modules/storage.bicep` — Add `Enrollments` table resource

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.1b] — Acceptance criteria for enrollment validation
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture] — Table Storage schema patterns
- [Source: _bmad-output/planning-artifacts/architecture.md#Naming Patterns] — Table names PascalCase, API folders kebab-case
- [Source: _bmad-output/planning-artifacts/architecture.md#API Response Format] — `{ success, data, error, meta }` format
- [Source: _bmad-output/planning-artifacts/architecture.md#Structure Patterns] — Co-located tests, one function per folder
- [Source: _bmad-output/project-context.md#4. API Contracts] — Backend API patterns and conventions
- [Source: _bmad-output/project-context.md#9. Directory Structure] — Monorepo file organization
- [Source: frontend/src/services/auth.js] — Current auth service with mock users and SWA integration
- [Source: backend/src/services/auth-utils.js] — Principal parsing and role extraction
- [Source: backend/src/functions/classes-api.js] — Existing get-subjects endpoint with group filtering
- [Source: frontend/src/main.js] — Router and bootstrap sequence

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List