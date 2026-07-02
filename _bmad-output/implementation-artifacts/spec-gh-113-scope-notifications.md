---
title: 'Scope notifications by authenticated student identity'
type: 'bugfix'
created: '2026-06-19'
status: 'done'
route: 'one-shot'
---

## Intent

**Problem:** The notifications endpoint allowed clients to specify a `userId` query/body parameter that could override or bypass the authenticated principal, creating a query-tampering vector where one user could read another's notifications.

**Approach:** Refactor `resolveEffectiveUserId` to derive user identity exclusively from the SWA-injected principal and validate any explicit `userId` against it, rejecting mismatches and unauthenticated requests.

## Suggested Review Order

**Authorization scoping**

- Entry point: the core identity resolution fix removing the pilot-phase query bypass
  [`notifications.js:53`](../../backend/src/functions/notifications.js#L53)

- Forbidden-access logging with user context at all three endpoints
  [`notifications.js:105`](../../backend/src/functions/notifications.js#L105)

- Unauthenticated request guard added to the GET handler
  [`notifications.js:113`](../../backend/src/functions/notifications.js#L113)

- PATCH handler forbidden log with principal context
  [`notifications.js:167`](../../backend/src/functions/notifications.js#L167)

- POST handler forbidden log with principal context
  [`notifications.js:214`](../../backend/src/functions/notifications.js#L214)
