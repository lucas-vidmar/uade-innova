# Walkthrough: User Story #16

**Feature/Story Name**: API Rate Limiting & DDOS Protection  
**Status**: Completed  
**Business Impact**: Enforces edge throttling to reduce FinOps burn risk from abusive scripts and strengthens resilience against request-flood behavior.

## What Changed
- Updated `infra/modules/frontdoor.bicep` to add a WAF custom `RateLimitRule`:
  - Rule name: `rate-limit-api-10rpm`
  - Scope: requests where URI begins with `/api/`
  - Threshold: `10` requests
  - Window: `1` minute
  - Action: `Block` (Front Door returns `429`)
- Re-enabled Front Door provisioning in `infra/main.bicep`:
  - Un-commented Front Door module instantiation.
  - Un-commented Key Vault secret write for `FRONT-DOOR-ID`.
  - Enabled `AZURE_FRONT_DOOR_URI` output.
- Added backend IaC contract tests in `backend/src/services/api-rate-limit-iac.test.js` to protect against regressions.
- Added Chrome usability coverage in `frontend/tests/api-rate-limit.spec.js` to verify students see a clear message when API responses are rate-limited (`429`).

## Verification Results
- **Backend tests**: Ran `npm test` in `backend`, including new IaC test coverage for Front Door rate limiting and module wiring.
- **Frontend Chrome usability test**: Ran `npx playwright test tests/api-rate-limit.spec.js` with Chrome channel and validated user-facing handling for `429` in chat.

## Backlog Refinement
- Add per-route differentiated limits (e.g., tighter limits for expensive `/api/rag-query` vs broader limits for lightweight reads).
- Add an admin metrics card showing recent `429` counts by endpoint to tune thresholds with real usage data.
