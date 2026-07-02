---
title: 'SAT trend window filtering (7/14/30 days)'
type: 'feature'
created: '2026-06-20'
status: 'done'
baseline_commit: 'f858661b4f8ce35e69b9d433ff360f5cec13c444'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** SAT-by-prompt analytics always aggregates all ratings for a subject with no time window, making it impossible to compare recent prompt performance against broader historical trends.

**Approach:** Add an optional `days` query parameter (allowed: 7, 14, 30) to the SAT analytics backend endpoint that filters ratings by `createdAt` within the window. Add a visual window selector (7/14/30 day pills) to the Director SAT Analytics UI that triggers a refetch. Default to 30 days.

## Boundaries & Constraints

**Always:**
- `days` must be clamped to allowed values {7, 14, 30}; invalid/missing values default to 30
- Backend filtering uses the `createdAt` ISO string stored in each rating entity
- UI window selector uses 3 pill-style buttons (7, 14, 30) with active state highlight
- Selected window must be reflected in the API request and visible in the UI

**Ask First:**
- If the existing ratings table lacks `createdAt` on older entities — they should be excluded from filtered results (no backfill)

**Never:**
- No new Azure Table or storage resources
- No server-side caching or precomputation
- No changes to the rating storage format

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid days param | `?subjectId=X&days=7` | Only ratings from last 7 days | N/A |
| Invalid days param | `?subjectId=X&days=99` | Treat as default (30 days) | No error, silent default |
| No days param | `?subjectId=X` | Default to 30 days | N/A |
| Class filter + days | `?subjectId=X&classId=Y&days=14` | Both filters applied | N/A |
| No ratings in window | `?subjectId=X&days=7` with 0 ratings | Empty segments, total=0 | N/A |
| Entity without createdAt | Old entity missing `createdAt` | Excluded from results | N/A |

</frozen-after-approval>

## Code Map

- `backend/src/functions/sat-analytics.js` — Backend endpoint GET /api/sat-analytics — add `days` param parsing, clamping, and createdAt-based date filtering
- `frontend/src/services/api.js` — API client — add `days` param to `getSatAnalytics()` call
- `frontend/src/pages/director/SatAnalytics.js` — Director SAT page — add window selector pills, pass `days` to API calls, surface selected window in UI

## Tasks & Acceptance

**Execution:**
- [x] `backend/src/functions/sat-analytics.js` — Parse `days` query param, clamp to {7, 14, 30} with default 30, filter entities by comparing `entity.createdAt` against computed window start date
- [x] `frontend/src/services/api.js` — Update `getSatAnalytics({ subjectId, classId })` to accept and pass `days` parameter
- [x] `frontend/src/pages/director/SatAnalytics.js` — Add pill-style window selector (7/14/30 days), include `days` in API calls, highlight active window, show selected window in UI context

**Acceptance Criteria:**
- Given a valid `days` param (7, 14, or 30), when the SAT analytics endpoint is called, then only ratings within that window are aggregated
- Given an invalid or missing `days` param, when the endpoint is called, then it defaults to 30 days
- Given the Director SAT page, when it loads, then the window selector shows 30 as the active default
- Given a window selection change, when the user clicks 7, 14, or 30, then the SAT table refreshes with the new window

## Suggested Review Order

**Backend: days param parsing & date filtering**

- `rawDays` clamped to allowed set {7,14,30} with silent default 30 — follows existing `computeDirectorMetrics` pattern
  [`sat-analytics.js:15`](../../backend/src/functions/sat-analytics.js#L15)

- Window start computed from UTC midnight minus (days-1) then entities filtered by `createdAt` — entities without or with invalid timestamps are excluded
  [`sat-analytics.js:41`](../../backend/src/functions/sat-analytics.js#L41)

- `windowDays` reflected in response filter object for UI state hydration
  [`sat-analytics.js:72`](../../backend/src/functions/sat-analytics.js#L72)

**Frontend API client: propagate days param**

- Add `days` to `getSatAnalytics()` signature and URL construction
  [`api.js:1669`](../../frontend/src/services/api.js#L1669)

**Frontend UI: window selector pills**

- Pill-style 7/14/30 day buttons with active state, click triggers refetch via shared `refreshSatData()`
  [`SatAnalytics.js:41`](../../frontend/src/pages/director/SatAnalytics.js#L41)

- `refreshSatData()` consolidates fetch logic for both class filter and window changes, preventing duplicate code
  [`SatAnalytics.js:140`](../../frontend/src/pages/director/SatAnalytics.js#L140)

## Verification

**Commands:**
- `npm run lint --prefix backend` — expected: no errors
- `npm run lint --prefix frontend` — expected: no errors (or warnings only)
