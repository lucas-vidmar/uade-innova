---
title: '11.1.1 Persistent AI Consent Across Sessions'
type: 'bugfix'
created: '2026-06-23'
status: 'done'
route: 'one-shot'
context:
  - 'frontend/src/services/auth.js'
  - 'backend/src/functions/consent-api.js'
  - 'frontend/src/pages/student/Settings.js'
---

# 11.1.1 Persistent AI Consent Across Sessions

## Intent

**Problem:** localStorage AI consent value is overwritten on every page load by the backend response (which returns `{ accepted: false }` when no record exists), forcing users to re-accept consent every session.

**Approach:** Preserve local `accepted: true` when backend returns `false`, store the `accepted` boolean server-side for proper revoke support, and add a consent management UI in Settings.

## Suggested Review Order

1. `frontend/src/services/auth.js:352-368` — initAuth consent sync with local-over-backend guard
2. `frontend/src/services/auth.js:163-176` — revokeAIConsent async method
3. `backend/src/functions/consent-api.js:126-133` — store accepted field in entity
4. `backend/src/functions/consent-api.js:60-67` — read accepted field in GET
5. `frontend/src/services/profile.api.js:58-75` — saveConsent parameter and error propagation
6. `frontend/src/pages/student/Settings.js` — full consent management UI section
