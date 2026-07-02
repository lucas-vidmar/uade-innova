# Implementation Plan: User Story #66

## Story
**Title:** Early Warning Pedagogical Alarms  
**As a** Director, **I want** the system to flag "At Risk" students based on low engagement.

## Acceptance Criteria Mapping
- Backend logic computes risk flags for Intervention List.
- Simulate student `<50%` attendance -> flags as Risk.

## Requirements & Constraints Analysis
1. **Risk computation must be deterministic:** convert attendance strings (`"45%"`) to numeric value and avoid ambiguous parsing.
2. **Backward compatibility:** keep `/api/sga/early-alerts` contract stable while extending payload with intervention metadata.
3. **Intervention filtering support:** Director view needs an explicit At-Risk list; backend should provide server-side filtering to reduce UI coupling.
4. **Role and perimeter safety:** preserve existing Front Door validation and endpoint behavior.
5. **Usability validation in Chrome:** ensure the Director can navigate and see the new intervention list using Chromium Playwright coverage.

## Edge Cases Considered
- Attendance missing/malformed (`null`, empty, non-percent string) -> parsed as `0` (conservative high-risk fallback).
- Missing engagement score -> treated as low engagement in current mock model to avoid silent false negatives.
- `interventionOnly=true` with no matches -> returns empty array, UI renders neutral empty state.
- Subject filtering combined with intervention filtering -> both applied cumulatively.

## Implementation Steps
1. **Backend (`sga-api`)**
   - Add risk computation helper using attendance + engagement score.
   - Extend early-alert payload with `interventionFlag` (`stable|watchlist|at_risk`).
   - Add optional `interventionOnly` query parameter on `/api/sga/early-alerts`.

2. **API Contract**
   - Update `docs/sga-openapi.json` for `interventionOnly` parameter and `interventionFlag` schema.

3. **Frontend API Service**
   - Extend `api.getEarlyAlerts(...)` to support intervention-only filtering and normalize new fields.

4. **Director UI**
   - Add an explicit “Lista de Intervención (At Risk)” card/table on Director dashboard.
   - Populate from `api.getEarlyAlerts({ interventionOnly: true })`.

5. **Tests**
   - Backend tests for:
     - `<50%` attendance maps to `risk=high` and `interventionFlag=at_risk`.
     - `interventionOnly=true` returns only at-risk students.
   - Chrome Playwright test validates Director dashboard intervention list rendering.

6. **Verification**
   - Run backend test file `sga-api.test.js`.
   - Run frontend Playwright test `director-powerbi-dashboard.spec.js` in Chromium.
