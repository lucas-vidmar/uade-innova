# Implementation Plan: User Story #60 (Polling Hardening)

**Feature/Story Name**: Real-time Processing Notifications (global toast after navigation)  
**Issue**: #60  
**Status**: Completed

## Requirements Analysis
- Keep global notification behavior when an AI upload job finishes.
- Ensure notification polling survives route changes and works from any teacher page.
- Cover edge cases in persisted job tracking data to avoid missed toasts or noisy polling.
- Verify behavior with a browser test that navigates the app (Chrome channel).

## Edge Cases & Technical Constraints
- Persisted tracked jobs can become malformed in `localStorage` (missing `materialId`/`subjectId`).
- Duplicate entries may exist for the same `subjectId + materialId` pair.
- Existing environments may use polling fallback paths and must remain compatible.
- Polling state should remain light and avoid duplicate checks/toasts.

## Planned Changes
1. Harden the processing notification service by normalizing/deduplicating persisted tracked jobs.
2. Normalize incoming `trackJob` payloads before enqueueing to polling state.
3. Add a new Playwright integration test (Chrome channel) that:
   - seeds invalid + valid tracked jobs,
   - navigates to a page,
   - verifies only the valid job resolves to a success toast.

## Verification Plan
- Execute processing notifications Playwright spec in Chrome channel.
- Confirm toast appears after navigation and valid job completion.
- Confirm no regression in existing processing-notification flow test.
