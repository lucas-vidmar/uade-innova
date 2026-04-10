# Implementation Plan: User Story #60

**Feature/Story Name**: Real-time Processing Notifications  
**Status**: Completed  
**Business Impact**: Teachers receive clear, global feedback when AI processing finishes, even if they navigate away from the upload page.

## Requirements Analysis
- Show a global toast when an upload processing job finishes.
- Notification must work outside the upload view (route-agnostic).
- Trigger mechanism can be polling or WebSocket. We will implement polling against existing `/api/classes` data.
- Preserve compatibility with current mock/local fallback behaviors.

## Edge Cases & Constraints
- User uploads multiple files in sequence (parallel tracked jobs).
- User uploads to multiple classes at once (same `materialId` visible in more than one class).
- Material may end in `ready` or `error` state.
- App is SPA; must survive hash route changes without losing pending jobs.
- Browser refresh should not lose pending tracking state (persist queue in localStorage).

## Planned Milestones
- [x] Add a global processing-notification service with persistent tracked jobs and polling lifecycle.
- [x] Integrate service in app bootstrap so polling is active across all routes.
- [x] Register newly uploaded processing jobs from teacher upload flow instead of forcing immediate `ready` state.
- [x] Emit success/error toasts when tracked job state changes to terminal state.
- [x] Add E2E browser test (Chromium/Chrome engine) validating: upload → navigate away → toast appears.
- [x] Run backend and frontend test suites.

## Scope Boundaries
- No backend WebSocket implementation in this story.
- No redesign of ingestion/status backend contracts; relies on existing material status in classes API.
- Notifications are in-app toasts only (no email/push).
