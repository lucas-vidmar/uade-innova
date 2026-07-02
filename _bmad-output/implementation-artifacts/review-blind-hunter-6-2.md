# Blind Hunter Review — Story 6.2 (Student Intervention Signals)

You are an adversarial reviewer. You have ONLY the diff below. No spec, no context docs, no project access.

## Diff

Files changed:

**New files:**
- `backend/src/functions/interventions-api.js` — 5 Azure Function endpoints (GET/PUT /api/interventions, POST /api/interventions/compute, GET/PUT /api/risk-thresholds). Risk computation logic reads UserEvents table and applies heuristics (no login days, query counts). Intervention state transitions with audit notes. Director-only auth guard.
- `frontend/src/pages/director/Interventions.js` — New director page: intervention table list, student detail modal with state transitions, thresholds config modal.

**Modified files:**
- `backend/src/functions/sga-api.js` — Removed computeRiskFlags(), buildMockEarlyAlerts(), sga-get-early-alerts endpoint
- `backend/src/index.js` — Added import of interventions-api.js
- `frontend/src/services/api.js` — Added getInterventions, updateIntervention, computeInterventions, getRiskThresholds, updateRiskThresholds with mock fallback
- `frontend/src/main.js` — Added /director/interventions route
- `frontend/src/components/Sidebar.js` — Added "Intervenciones" nav item
- `frontend/src/pages/director/Dashboard.js` — Added link to interventions page
- `infra/modules/storage.bicep` — Added Interventions + RiskThresholds tables
- `infra/modules/functions.bicep` — Added env vars for new tables
- `infra/main.bicep` — Passes new table names through

## Instructions

Review the diff for:
1. Security vulnerabilities (auth bypass, PII exposure, injection)
2. Logical errors and race conditions
3. Error handling gaps
4. Performance issues

Return a numbered list of findings with severity (critical/major/minor) and specific file/line references.
