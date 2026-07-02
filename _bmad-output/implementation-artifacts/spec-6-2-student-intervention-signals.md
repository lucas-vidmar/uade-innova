---
title: 'Story 6.2 — Student Intervention Signals'
type: 'feature'
created: '2026-06-19'
status: 'done'
baseline_commit: '22c4e3cd266f83a7ba42dce801b791484d242365'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/6-1-adoption-and-cost-dashboard.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Director dashboard shows aggregated risk counts but no student-level intervention data. Risk scoring uses hardcoded mock values instead of real engagement telemetry, with no workflow tracking.

**Approach:** Compute risk from real UserEvents telemetry, add per-subject configurable thresholds, and implement an intervention workflow panel with state tracking (assigned→contacted→resolved).

## Boundaries & Constraints

**Always:**
- Risk heuristics: no login 7d = low; no login 14d or <2 queries/7d = medium; no login 21d and <5 queries/14d = high
- Intervention lifecycle: assigned, contacted, resolved — each transition stores actor, timestamp, optional note
- Dedicated "Intervenciones" page with anonymized student IDs (hashed, no PII)
- Per-subject threshold overrides with sensible defaults fallback
- Missing telemetry = excluded from classification (safe fallback)

**Ask First:**
- Whether Interventions panel should be new page or section within Dashboard.js

**Never:**
- No PII in director endpoints; no SessionMetrics schema changes; no charting libraries (use Canvas API); no hardcoded thresholds

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Active student at risk | No login 14d, 1 query/7d | Risk: medium, reason: "Sin login 14d, baja actividad" | N/A |
| Inactive student | No login 21d, 0 queries/14d | Risk: high, reason: "Sin login 21d, sin actividad" | N/A |
| Engaged student | Daily login, 10+ queries/7d | Risk: low (excluded from active queue) | N/A |
| Missing telemetry | No UserEvents rows | Excluded from classification | Silently skip |
| State transition | PUT intervention { status: "contacted", note: "..." } | Updated, audit appended, 200 | 404 if invalid id; 400 if invalid transition |
| Filter by state | GET /api/interventions?state=assigned | Only assigned interventions | Empty array if none |
| Get thresholds | GET /api/risk-thresholds?subjectId=X | Subject override or defaults | 200 with defaults |
| Update thresholds (Director) | PUT thresholds { attendance: 60 } | Updated + audit logged | 403 if not Director |

</frozen-after-approval>

## Code Map

- `infra/modules/storage.bicep` — Add Interventions + RiskThresholds tables
- `backend/src/functions/interventions-api.js` — New file: risk computation from UserEvents, GET/PUT interventions, GET/PUT risk-thresholds
- `backend/src/functions/sga-api.js` — Remove mock computeRiskFlags/buildMockEarlyAlerts
- `frontend/src/pages/director/Interventions.js` — New page: intervention list + detail modal + thresholds config
- `frontend/src/services/api.js` — Add getInterventions, updateIntervention, getRiskThresholds, updateRiskThresholds
- `frontend/src/main.js` + `Sidebar.js` — Register route + nav item
- `frontend/src/pages/director/Dashboard.js` — Link early alerts to interventions page

## Tasks & Acceptance

**Execution:**
- [x] `infra/modules/storage.bicep` — Add Interventions (PK=subjectId, RK=studentId) and RiskThresholds (PK=subjectId, RK='config') tables
- [x] `backend/src/functions/interventions-api.js` — Risk computation reading UserEvents with window; GET /api/interventions (filter by state/risk/subjectId); PUT state transition with audit; GET/PUT /api/risk-thresholds with Director guard
- [x] `backend/src/functions/sga-api.js` — Remove mock risk functions
- [x] `frontend/src/services/api.js` — Client methods + mock data
- [x] `frontend/src/pages/director/Interventions.js` — Table with risk level badges, student detail modal, state transition actions, thresholds config section
- [x] `frontend/src/pages/director/Dashboard.js` — Link to interventions page
- [x] `frontend/src/main.js` + `Sidebar.js` — Route + nav

**Acceptance Criteria:**
- Given risk computation runs, when a student has no login 14d and <2 queries/7d, then an intervention record is created with risk=medium and descriptive reason
- Given I am a Director, when I visit the Intervenciones page, then I see a table of at-risk students with anonymized IDs, risk level, reason, and workflow state
- Given I click an intervention row, when the detail modal opens, then I can transition state with optional note
- Given I resolve an intervention, when the active queue loads, then it is excluded
- Given I open threshold config, when I change a threshold and save, then it persists and an audit entry is logged

## Verification

**Commands:**
- `node --experimental-test-module-mocks --test src/functions/interventions-api.test.js`

**Manual checks:**
- Director dashboard → Intervenciones page → verify risk list, detail modal, state transitions, threshold config all work
