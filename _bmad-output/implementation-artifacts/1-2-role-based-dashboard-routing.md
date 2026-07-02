# Story 1.2: Role-Based Dashboard Routing

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want to see the dashboard appropriate for my role,
so that I access only relevant features and subjects.

## Acceptance Criteria

### AC1: Role-Based Post-Auth Redirection
**Given** I successfully authenticate via Entra ID (or mock auth in dev mode)
**When** `auth.initAuth()` completes and determines my role
**Then** I am redirected to the role-appropriate dashboard:
  - `/student/dashboard` if role="student"
  - `/teacher/dashboard` if role="teacher"
  - `/director/dashboard` if role="director"

### AC2: Cross-Role Route Guard
**Given** I am authenticated with role="student"
**When** I manually navigate to `#/teacher/dashboard` or `#/director/dashboard`
**Then** I am redirected to `#/student/dashboard`

**Given** I am authenticated with role="teacher"
**When** I manually navigate to `#/student/dashboard` or `#/director/dashboard`
**Then** I am redirected to `#/teacher/dashboard`

**Given** I am authenticated with role="director"
**When** I manually navigate to `#/student/dashboard` or `#/teacher/dashboard`
**Then** I am redirected to `#/director/dashboard`

### AC3: Teacher Subject Filtering in Sidebar
**Given** I am a teacher
**When** I access the teacher dashboard
**Then** the subject dropdown in the top nav only shows subjects where my `Enrollments` record has `role="teacher"`

**Given** I am a student
**When** I access the student dashboard
**Then** the subject dropdown shows all subjects where I have active enrollment (any role)

### AC4: Default Unknown Route Handling
**Given** I navigate to a non-existent route (e.g., `#/unknown/path`)
**When** the router cannot match the path
**Then** I am redirected to my role-appropriate dashboard (not a generic 404)

### AC5: Role Change Triggers Redirection
**Given** I am on a dashboard page
**When** my role changes (e.g., via the profile panel role switcher in dev mode)
**Then** I am redirected to the new role's dashboard

## Tasks / Subtasks

- [x] Task 1: Implement Cross-Role Route Guards in Router (AC: #2, #4)
  - [x] 1.1 Update `frontend/src/main.js` `handleRoute()` to check if `matchedPath` starts with a role prefix different from `auth.getRole()`
  - [x] 1.2 Add role-prefix validation BEFORE route loading: extract expected role from path (`/student/*`, `/teacher/*`, `/director/*`, `/admin/*`) and compare with `auth.getRole()`
  - [x] 1.3 If role mismatch, redirect to `#/{actualRole}/dashboard` instead of loading the route
  - [x] 1.4 Ensure the existing admin guard (`/admin` requires director) still works and is not broken
  - [x] 1.5 Update the default unknown route handler (the `else` branch when `routeLoader` is undefined) to redirect to `#/{role}/dashboard` instead of just using `auth.getRole()` without redirection

- [x] Task 2: Ensure Post-Auth Redirection to Role Dashboard (AC: #1)
  - [x] 2.1 Update `frontend/src/main.js` `bootstrap()` function: after `auth.initAuth()` completes, if `window.location.hash` is empty OR points to a route for a different role, set `window.location.hash = #/{role}/dashboard`
  - [x] 2.2 Ensure the existing logic in bootstrap that sets default hash on first load respects the authenticated role (already partially done — verify it handles role mismatch)
  - [x] 2.3 After role change event (`auth:roleChanged`), ensure `handleRoute()` redirects if current path doesn't match new role

- [x] Task 3: Filter Teacher Subjects by Enrollment Role (AC: #3)
  - [x] 3.1 Update `frontend/src/components/Sidebar.js`: in `renderSidebar()`, when calling `auth.getEnrolledSubjects()`, verify the returned list is already filtered by role for teachers
  - [x] 3.2 If `auth.getEnrolledSubjects()` returns subjects where student is enrolled (not teacher), add explicit filtering: if `user.role === 'teacher'`, only show subjects where enrollment has `role === 'teacher'`
  - [x] 3.3 Verify the `getEnrolledSubjects()` in `auth.js` already filters by role for teachers — if not, fix it there
  - [x] 3.4 Ensure the subject dropdown renders correctly when filtered list is empty (show "Sin materias asignadas")

- [x] Task 4: Handle Role Change Redirection (AC: #5)
  - [x] 4.1 In `frontend/src/components/Sidebar.js`, update the role switcher click handler: after `auth.mockLoginAs(role)` and `window.location.hash = #/{role}/dashboard`, ensure the page reloads or router handles the change
  - [x] 4.2 Verify the `auth:roleChanged` event listener in `main.js` triggers `handleRoute()` and the role guard redirects correctly

- [x] Task 5: Testing (AC: All)
  - [x] 5.1 Test student cannot access teacher routes (manually navigate to `#/teacher/dashboard` → should redirect to `#/student/dashboard`)
  - [x] 5.2 Test teacher cannot access student/director routes
  - [x] 5.3 Test director can access admin routes (existing behavior) but not student/teacher routes
  - [x] 5.4 Test unknown route redirects to role dashboard
  - [x] 5.5 Test role switcher in profile panel redirects to correct dashboard
  - [x] 5.6 Test teacher sidebar only shows teacher-assigned subjects

- [x] Task 6: Deploy and Verify (AC: All)
  - [x] 6.1 Run `azd deploy` after code changes
  - [x] 6.2 Verify student login redirects to `#/student/dashboard`
  - [x] 6.3 Verify teacher login redirects to `#/teacher/dashboard`
  - [x] 6.4 Verify director login redirects to `#/director/dashboard`
  - [x] 6.5 Verify cross-role navigation is blocked

## Dev Notes

### EXISTING CODE — DO NOT REWRITE FROM SCRATCH

This is a **BROWNFIELD** project with existing routing and auth code that MUST be extended:

**`frontend/src/main.js`** — Already has:
- Hash-based router with `handleRoute()` function ✓
- `ROUTES` registry with role-prefixed paths (`/student/*`, `/teacher/*`, `/director/*`, `/admin/*`) ✓
- Admin path guard: `/admin` requires director role (lines 66-70) ✓
- `bootstrap()` that calls `auth.initAuth()` and sets default hash ✓
- `auth:roleChanged` event listener that triggers `handleRoute()` ✓

**Issues to FIX (not rewrite):**
1. No cross-role route guards exist — a student can manually navigate to `#/teacher/dashboard` and it will load
2. The default route handler (line 97-100) only redirects when route is unknown, but doesn't verify role matches
3. `bootstrap()` sets default hash based on role but doesn't enforce role-path alignment on existing hash

**`frontend/src/components/Sidebar.js`** — Already has:
- Role-aware navigation items (`NAV.student`, `NAV.teacher`, `NAV.director`) ✓
- Subject dropdown populated via `auth.getEnrolledSubjects()` ✓
- Role switcher for demo mode ✓

**Issues to FIX:**
1. `auth.getEnrolledSubjects()` may not filter by `enrollment.role === 'teacher'` for teachers — verify and fix if needed
2. Subject dropdown doesn't handle empty filtered list gracefully for teachers

**`frontend/src/services/auth.js`** — Already has:
- `getRole()` returns current role from sessionStorage ✓
- `getEnrolledSubjects()` filters by enrollment status (active) ✓
- For teachers, it filters `enrollmentData.filter(e => e.role === 'teacher' && e.status === 'active')` (lines 159-163) ✓

**Verification needed:** Confirm `getEnrolledSubjects()` works correctly for teachers. The code at lines 159-163 appears correct, but test thoroughly.

### Architecture Compliance

- **Frontend:** Vanilla JS + Vite, component pattern (one class/function per file), CSS variables from Design System
- **Backend:** No backend changes required for this story — pure frontend routing enhancement
- **Naming:** kebab-case for files (`main.js`, `sidebar.js`), camelCase for functions (`handleRoute`, `getRole`), PascalCase for classes
- **API responses:** Not applicable (no new API calls in this story)
- **Error handling:** Use `console.error` or `console.warn` for routing errors; no `context.log()` needed (frontend only)
- **Auth:** SWA EasyAuth for production, mock role system for local development

### Routing Architecture

The router uses hash-based navigation:
- Routes are defined as `/student/dashboard`, `/teacher/dashboard`, etc.
- Each path has a role prefix: `/student/*`, `/teacher/*`, `/director/*`, `/admin/*`
- The router lazy-loads page modules via dynamic `import()`

**Role guard pattern to implement:**
```javascript
// In handleRoute(), BEFORE loading the route:
const expectedRole = matchedPath.split('/')[1]; // "student", "teacher", "director", "admin"
const actualRole = auth.getRole();

const rolePrefixMap = {
  'student': ['student'],
  'teacher': ['teacher'],
  'director': ['director', 'admin'], // director can access admin
};

const allowedPrefixes = rolePrefixMap[actualRole] || ['student'];
if (!allowedPrefixes.includes(expectedRole)) {
  window.location.hash = `#/${actualRole}/dashboard`;
  return;
}
```

**IMPORTANT:** The existing admin guard (lines 66-70) checks if the path starts with `/admin` and the role is not director. This should be kept but can be consolidated into the new general role guard. Ensure backward compatibility — don't break the existing admin guard behavior.

### Subject Filtering for Teachers

Current flow in `auth.getEnrolledSubjects()`:
1. Gets enrollment data from `enrollmentService.getCachedEnrollments()`
2. For teachers, filters to `e.role === 'teacher' && e.status === 'active'`
3. Maps to subject IDs and intersects with `user.subjects`

If this works correctly, no changes needed in `auth.js`. The key verification is:
- Teacher with enrollment `{subjectId: "arq-software-2026", role: "teacher"}` should see only that subject
- Teacher with NO teacher enrollments should see empty subject list

### Dev Mode Considerations

The role switcher in the profile panel (Sidebar.js lines 148-152) allows changing roles:
```javascript
auth.mockLoginAs(role);
window.location.hash = `#/${role}/dashboard`;
window.location.reload();
```

This already handles redirection on role change via page reload. After reload, `bootstrap()` runs and `handleRoute()` executes with the new role.

### Security Considerations

- Route guards are **frontend-only** and can be bypassed by determined users
- Real authorization must happen on backend API calls (already implemented in Story 1.1b)
- Frontend guards are UX measures, not security measures — they prevent confusion, not attacks
- Backend endpoints already validate enrollment and role via `auth-utils.js`

### Project Structure Notes

- UPDATE file: `frontend/src/main.js` — Add cross-role route guards, fix default route handling
- UPDATE file: `frontend/src/components/Sidebar.js` — Verify teacher subject filtering (may need no changes)
- No new files needed
- No backend changes needed
- No tests to create (manual testing via browser navigation)

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.2] — Acceptance criteria for role-based routing
- [Source: _bmad-output/planning-artifacts/architecture.md#Frontend Architecture] — SPA routing pattern, Vanilla JS component architecture
- [Source: _bmad-output/planning-artifacts/architecture.md#Naming Patterns] — kebab-case files, camelCase functions
- [Source: _bmad-output/planning-artifacts/ux-design.md#Screen Specifications] — Dashboard layouts per role
- [Source: frontend/src/main.js] — Existing hash router and route guards
- [Source: frontend/src/components/Sidebar.js] — Role-aware navigation and subject dropdown
- [Source: frontend/src/services/auth.js] — Role extraction and enrollment filtering
- [Source: _bmad-output/implementation-artifacts/1-1a-entra-id-sso-integration.md] — Auth patterns established
- [Source: _bmad-output/implementation-artifacts/1-1b-enrollment-validation.md] — Enrollment filtering patterns

## Dev Agent Record

### Agent Model Used

deepseek-v4-pro

### Debug Log References

- Production verification: `[Router] Access Denied: student cannot access /teacher/dashboard` confirmed guard working
- Deployment endpoint: https://agreeable-beach-002ff0c0f.6.azurestaticapps.net/#/student/dashboard

### Completion Notes List

- **Task 1-2**: Replaced existing admin-only guard with unified role-based access control in `handleRoute()` using `rolePrefixMap`. Student → student routes, teacher → teacher routes, director → director + admin routes. Added same guard to `bootstrap()` for post-auth verification.
- **Task 3**: Verified `auth.getEnrolledSubjects()` correctly filters by `enrollment.role === 'teacher'` for teachers (lines 159-163 in auth.js). Added "Sin materias asignadas" empty state in Sidebar.js subject dropdown.
- **Task 4**: Confirmed role switcher already handles redirection correctly via `mockLoginAs()` + `window.location.reload()`.
- **Task 5-6**: Built, deployed, and verified in production. Cross-role guard blocks student→teacher navigation. Default redirect goes to role-appropriate dashboard.

### File List

- `frontend/src/main.js` — Added unified role-based route guard in `handleRoute()` and `bootstrap()`
- `frontend/src/components/Sidebar.js` — Added empty state message for teachers with no assigned subjects
