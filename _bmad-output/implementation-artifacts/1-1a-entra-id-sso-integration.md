# Story 1.1a: Entra ID SSO Integration

Status: blocked

## Story

As a user (student, teacher, or director),
I want to log in with my UADE institutional account via Microsoft Entra ID,
so that I don't need a separate password and my role is automatically determined.

## Acceptance Criteria

1. **AC1: SSO Login Flow** — Given I click "Iniciar sesion con UADE", When I am redirected to Microsoft Entra ID, Then I authenticate with my UADE credentials, And I am redirected back to the dashboard with a valid session (clientPrincipal parsed from SWA `/.auth/me`).

2. **AC2: Unauthenticated Redirect** — Given I am not authenticated, When I try to access any page other than login, Then I am redirected to the login page (not simply allowed through with a mock role).

3. **AC3: Role Extraction** — Given I successfully authenticate via Entra ID, When the system reads my principal from `/.auth/me`, Then my role (student/teacher/director) is determined from Entra ID group membership or `extension_role` claim, And I am redirected to the appropriate dashboard (`/student/dashboard`, `/teacher/dashboard`, or `/director/dashboard`).

4. **AC4: Logout** — Given I am authenticated, When I click "Cerrar sesion", Then I am redirected to `/.auth/logout?post_logout_redirect_uri=/` and my session is cleared.

5. **AC5: Dev Mode Bypass** — Given I am running on `localhost` in development mode, When no Entra ID authentication is available, Then I can select a mock role (student/teacher/director) to test the application, with a visible visual indicator that I am in dev mode.

## Tasks / Subtasks

- [ ] Task 1: Create Login Page Component (AC: #1, #2, #5)
  - [ ] 1.1 Create `frontend/src/pages/LoginPage.js` with "Iniciar sesion con UADE" button that calls `/.auth/login/aad`
  - [ ] 1.2 Create `frontend/src/pages/LoginPage.css` following Design System tokens (dark mode, `--surface-1` background, brand gradient button)
  - [ ] 1.3 Add dev-mode mock role selector (dropdown with student/teacher/director) visible only on `localhost`
  - [ ] 1.4 Add visual dev-mode badge (`[DEV]`) in Header when running locally

- [ ] Task 2: Refactor Auth Service for Proper SSO Flow (AC: #1, #2, #3, #4)
  - [ ] 2.1 Update `frontend/src/services/auth.js` `isAuthenticated()` to properly check SWA authentication state (return false if `/.auth/me` returned no principal AND not on localhost)
  - [ ] 2.2 Update `frontend/src/services/auth.js` `initAuth()` to properly handle the unauthenticated case: if SWA auth fails and not localhost, redirect to login page
  - [ ] 2.3 Update `frontend/src/services/auth.js` `initAuth()` to extract role from `clientPrincipal.userRoles` (already partially done — verify "Docente" → teacher, "Director" → director mapping)
  - [ ] 2.4 Update `frontend/src/services/auth.js` to store `clientPrincipal.userId` as the canonical user ID (replacing mock IDs)
  - [ ] 2.5 Ensure `logout()` works in both SWA production and dev mode (SWA: `/.auth/logout?post_logout_redirect_uri=/`)

- [ ] 3: Update Router Auth Guard (AC: #2)
  - [ ] 3.1 Update `frontend/src/main.js` `handleRoute()` to check `auth.isAuthenticated()` before rendering any page
  - [ ] 3.2 Add redirect to login page (`#/login`) when `isAuthenticated()` returns false
  - [ ] 3.3 Add `#/login` route in `ROUTES` pointing to `LoginPage.js`
  - [ ] 3.4 After successful auth, redirect from login to the role-appropriate dashboard

- [ ] Task 4: Update Backend Auth Utilities (AC: #3)
  - [ ] 4.1 Update `backend/src/services/auth-utils.js` `getAuthenticatedUser()` to return structured user object with `userId`, `role`, `email`, `name` from SWA principal
  - [ ] 4.2 Ensure role mapping is consistent: SWA `clientPrincipal.userRoles` ("Docente" → teacher, "Director" → director, default → student)
  - [ ] 4.3 Add `x-ms-client-principal` validation: reject requests with invalid/expired tokens (return 401)

- [ ] Task 5: Configure SWA Entra ID Authentication (AC: #1)
  - [ ] 5.1 Update `infra/modules/staticwebapp.bicep` to add Entra ID (AAD) identity provider configuration for the Static Web App
  - [ ] 5.2 Add `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET` references in Bicep (from Key Vault or app settings)
  - [ ] 5.3 Add `ENTRA_ID_TENANT_ID` to app settings for token validation
  - [ ] 5.4 Test SWA `/.auth/login/aad` redirect flow end-to-end after deployment

- [ ] Task 6: Deploy and Verify (AC: All)
  - [ ] 6.1 Run `azd deploy` after code changes
  - [ ] 6.2 Navigate to the SWA URL and verify unauthenticated users see login page
  - [ ] 6.3 Click "Iniciar sesion con UADE" and verify Entra ID redirect
  - [ ] 6.4 Verify role-based dashboard routing after authentication
  - [ ] 6.5 Verify logout redirects to login page

## Dev Notes

### EXISTING CODE — DO NOT REWRITE FROM SCRATCH

This is a BROWNFIELD project with existing auth code that MUST be extended, not replaced:

**`frontend/src/services/auth.js`** — Already has:
- `initAuth()` that calls `/.auth/me` and parses `clientPrincipal` ✓
- Role mapping: `isDocente` → teacher, `isDirector` → director ✓
- Logout via `/.auth/logout` ✓
- Mock user system for local development ✓
- `getRole()`, `setRole()`, `getActiveSubjectId()` — all functional ✓

**Issues to FIX (not rewrite):**
1. `isAuthenticated()` currently returns `isDev` boolean (line 121-122) — must change to properly check SWA auth state
2. No login page or redirect for unauthenticated users — app currently bypasses auth entirely in dev
3. `initAuth()` falls through to mock mode silently without redirecting to login — need explicit auth check
4. No "Iniciar sesion con UADE" button exists anywhere — need LoginPage component

**`backend/src/services/auth-utils.js`** — Already has:
- `parseClientPrincipal()` that reads `x-ms-client-principal` header ✓
- `getAuthenticatedUser()` that returns userId, sanitizedId, principal, role ✓
- Mock role fallback via `x-mock-role` header ✓

**Issues to FIX:**
1. `getAuthenticatedUser()` returns only basic fields — needs to return `email` and `name` from principal claims
2. No 401 rejection for completely unauthenticated requests (currently returns anonymous user)
3. `validateFrontDoorId()` is hardcoded to `return true` — acceptable for pilot, but document it

**`frontend/src/main.js`** — Already has:
- Hash-based router with role-based routing ✓
- Route guard for admin paths ✓
- Auth initialization via `auth.initAuth()` ✓

**Issues to FIX:**
1. No auth check before rendering pages — if `isAuthenticated()` is false, still renders content
2. No `#/login` route defined

### Architecture Compliance

- **Frontend:** Vanilla JS + Vite, component pattern (one class/function per file), CSS variables from Design System
- **Backend:** Node.js 20, ESM modules, Azure Functions v4 model
- **Naming:** kebab-case for files (`login-page.js`), camelCase for functions (`handleLogin`), PascalCase for classes
- **API responses:** `{ success, data, error, meta }` format
- **Error handling:** `context.log()` in Functions, structured error objects with `materialId`/`userId` context
- **Auth:** API Keys in env vars (NOT Managed Identities, per AGENTS.md constraint), SWA EasyAuth for frontend

### SWA EasyAuth Architecture (CRITICAL)

Azure Static Web Apps provides built-in authentication via "EasyAuth". The flow is:

1. User clicks button → browser navigates to `/.auth/login/aad`
2. Azure redirects to Microsoft Entra ID login page
3. After authentication, Entra ID redirects back to SWA
4. SWA sets authentication cookies and redirects back to the app
5. Frontend calls `/.auth/me` to get `clientPrincipal` with userId, userDetails, userRoles
6. Backend receives `x-ms-client-principal` header (base64-encoded JSON) on every API call

**DO NOT** implement custom OIDC flows — use SWA's built-in authentication endpoints:
- Login: `/.auth/login/aad`
- Logout: `/.auth/logout?post_logout_redirect_uri=/`
- User info: `/.auth/me`

### Entra ID App Registration Requirements

The UADE IT team must create/register:
1. An Entra ID App Registration with redirect URI matching the SWA URL
2. The App Registration must expose `extension_role` claim OR group membership
3. Required API permissions: `User.Read`, `GroupMember.Read.All`
4. The `clientId`, `clientSecret`, and `tenantId` must be configured in SWA app settings

### Security Considerations

- SWA EasyAuth handles JWT validation — no need for manual token verification on frontend
- Backend MUST validate `x-ms-client-principal` header on every authenticated API call
- Rate limiting applies per userId (not per IP) for authenticated users
- Session cookies are set by SWA — do not store JWT tokens in localStorage
- Dev mode mock authentication is ONLY for localhost — production MUST use Entra ID

### Project Structure Notes

- New file: `frontend/src/pages/LoginPage.js` (NEW)
- New file: `frontend/src/pages/LoginPage.css` (NEW)
- UPDATE file: `frontend/src/services/auth.js` — Fix `isAuthenticated()`, enhance `initAuth()` auth guard
- UPDATE file: `frontend/src/main.js` — Add login route, add auth redirect guard
- UPDATE file: `backend/src/services/auth-utils.js` — Enhance `getAuthenticatedUser()` with email/name, add 401 handling
- UPDATE file: `infra/modules/staticwebapp.bicep` — Add Entra ID identity provider configuration
- No changes to: `frontend/src/components/PrivacyModal.js`, `frontend/src/services/api.js`, `frontend/src/components/Header.js`

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.1a] — Acceptance criteria for Entra ID SSO
- [Source: _bmad-output/planning-artifacts/architecture.md#Decision 2.1] — Rate limiting + Content Safety
- [Source: _bmad-output/planning-artifacts/architecture.md#Naming Patterns] — kebab-case files, camelCase JSON, PascalCase classes
- [Source: _bmad-output/planning-artifacts/architecture.md#Structure Patterns] — Project organization, co-located tests
- [Source: _bmad-output/planning-artifacts/architecture.md#API Response Format] — `{ success, data, error, meta }` format
- [Source: _bmad-output/planning-artifacts/architecture.md#Error Handling] — context.log() pattern with materialId/userId
- [Source: _bmad-output/planning-artifacts/ux-design.md#Design Tokens] — Dark mode colors, Montserrat typography
- [Source: frontend/src/services/auth.js] — Existing auth service with mock and SWA integration
- [Source: backend/src/services/auth-utils.js] — Existing principal parsing and role extraction
- [Source: frontend/src/main.js] — Existing hash router and auth initialization
- [Source: infra/modules/staticwebapp.bicep] — Current SWA config (no auth provider configured)

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List