# Implementation Plan: User Story #94

**Feature/Story Name**: Per-notification quick actions and feedback  
**Status**: In Progress  
**Business Impact**: Students get a faster and clearer inbox workflow by marking single notifications as read with immediate visual and toast feedback, improving perceived responsiveness and reducing notification fatigue.

## Requirements & Constraints Analysis
- Story requires per-notification quick actions with immediate feedback and production-safe behavior.
- Existing notification flow is read-only (`GET /api/notifications`) and merges persisted + mock records.
- Subject/user scoping must prevent users from updating notifications they do not own.
- Errors must be actionable but sanitized (no stack traces or sensitive details).
- Telemetry must capture success/failure dimensions for observability in App Insights.

## Edge Cases Considered
- Missing payload fields (`notificationId`, `subjectId`, `userId`) should return `400` with clear validation error.
- Notification not found under the selected `subjectId` should return `404`.
- Student attempting to mark another student’s notification should return `403`.
- Persisted notification with recipient filtering must remain inaccessible to non-recipient users.
- Frontend optimistic update must rollback when backend mark-read fails.

## Functional Analysis Mapping (Hito 1 alignment)
- Maps to student “notification center” management flow in the dashboard presentation layer.
- Preserves pilot data contracts by extending notification entity with per-user read state (`readByUserIds`) while keeping existing fields backward compatible.
- Does not alter RAG retrieval/chunking pipeline; RAG constraints remain unchanged for this story.

## Proposed Architecture Changes
1. **Backend API extension**
   - Add `PATCH /api/notifications/{id}/read`.
   - Validate request origin (Front Door), payload, and principal authorization.
   - Enforce subject + recipient scoping before persistence.
2. **Notification storage extension**
   - Add normalized `readByUserIds: string[]` in notification store.
   - Add service method to mark a specific notification as read for a specific user.
3. **Frontend quick action + feedback**
   - Add per-item quick action (“Marcar leída”) in notification dropdown.
   - Apply optimistic unread toggle and success/error toasts.
   - Keep existing item click navigation behavior.
4. **Observability**
   - Emit App Insights custom event `NotificationInteraction` with `action`, `status`, `userId`, `subjectId`, and `notificationId`.

## Azure Resources & Environment Impact
- **Application Insights (`appi-dashboard-{token}`)**: New custom event stream `NotificationInteraction` for mark-read interactions.
- **Azure Functions (`func-dashboard-ingest-{token}`)**: New HTTP route for mark-read quick action.
- **Storage account (`stdashboard{token}`)**: Notification JSON shape extended with `readByUserIds`.

## Environment Variables
- No new environment variables required.

## Planned Verification
- Backend unit tests:
  - `notifications.test.js`: success + unauthorized mark-read scenarios.
  - `notification-store.test.js`: persistence of `readByUserIds`.
- Frontend E2E test updates:
  - `notifications.spec.js`: quick action shows immediate badge feedback and calls mark-read endpoint.
- Manual browser walkthrough:
  - Student opens notification center, marks one item read, sees badge decrement and toast feedback.

## Out of Scope
- “Mark all as read” server persistence (kept UI-local for this iteration).
- Push notifications or real-time websocket delivery.
- Notification deletion/archive semantics.
