---
title: 'SAT significance guardrails for prompt winner selection'
type: 'feature'
created: '2026-06-20'
status: 'in-review'
baseline_commit: 'ccbf05667b166940fbc67a634aabc0c0500dcb35'
context:
  - '_bmad-output/implementation-artifacts/epic-7-context.md'
  - 'backend/src/functions/sat-analytics.js'
  - 'frontend/src/pages/director/SatAnalytics.js'
  - 'backend/src/services/prompts.js'
  - 'frontend/src/services/api.js'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The SAT analytics endpoint computes `satScore` as a simple ratio (`positive / rated`) per prompt version and surfaces all scores regardless of sample size or statistical significance. With random A/B shadow testing and identical prompt content, observed SAT differences are purely noise — there is no guardrail to prevent declaring a "winner" based on insufficient data.

**Approach:** Add a configurable minimum sample size and a two-proportion z-test significance guardrail to the SAT analytics pipeline. The backend computes significance between the best-performing and second-best prompt versions; if criteria are unmet, the winner state is `insufficient_data`. The frontend renders the winner indicator (or "insuficiente" badge) consistently from the backend payload.

## Boundaries & Constraints

**Always:**
- Minimum sample size is configurable via env var `SAT_MIN_RATED_THRESHOLD` (default 10)
- Significance method is two-proportion z-test (alpha = 0.05)
- Winner declaration requires BOTH minimum sample AND statistical significance
- Backend response includes `winner` field with states: `declared`, `insufficient_data`, or `tie`
- `winner` is computed server-side — frontend renders from payload, never computes
- All segments are still returned (significance doesn't hide data, only the winner badge)

**Ask First:**
- What p-value threshold to use? (default 0.05 proposed)
- Whether sticky user-to-prompt assignment should be added for cleaner A/B (out of scope for this story, but should be documented in Design Notes as future improvement)

**Never:**
- Do NOT add a new Azure Table or database — significance is computed in-memory from the existing `ConversationRatings` query
- Do NOT modify the prompt selection logic (`getShadowPrompt()`)
- Do NOT remove any existing fields from the SAT analytics response
- Do NOT modify the ChatWidget rating flow

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| One segment only (single prompt version) | Only v1-baseline has ratings | `winner: insufficient_data` — can't compare | N/A |
| All segments below min threshold | v1={rated:3}, v2={rated:5}, threshold=10 | Both segments returned. `winner: insufficient_data` — insufficient_data_both | N/A |
| Best segment meets threshold, but no significance | v1={rated:20, positive:12}, v2={rated:22, positive:14} | Both segments returned. `winner: insufficient_data` — insufficient_data_not_significant | N/A |
| Best segment meets threshold AND significance | v1={rated:30, positive:25}, v2={rated:28, positive:14} | Both segments returned. `winner: declared`, `winnerPromptVersion: v1`, `pValue: 0.003` | N/A |
| Third segment with very low rated | v1={rated:30, positive:25}, v2={rated:28, positive:14}, v3={rated:2, positive:1} | v3 ignored as contender. Winner computed between v1 and v2 only. | N/A |
| Tie (exact equal satScore after threshold) | v1={rated:20, positive:15}, v2={rated:20, positive:15} | `winner: tie` | N/A |
| No ratings at all | Empty entity list | `segments: []`, `winner: insufficient_data` | N/A |
| Only one rated entity | v1={rated:1, positive:1} | `winner: insufficient_data` | N/A |

</frozen-after-approval>

## Code Map

- `backend/src/services/significance.js` — NEW. Two-proportion z-test, comparison logic, winner determination
- `backend/src/functions/sat-analytics.js` — MODIFY. Import significance service, compute winner after aggregating segments
- `frontend/src/pages/director/SatAnalytics.js` — MODIFY. Render winner badge from response payload
- `frontend/src/services/api.js` — MODIFY. Update mock data to include `winner` field
- `backend/src/services/telemetry.js` — MODIFY. Add `winnerDeclared` property to `RAGInteraction` event

## Tasks & Acceptance

**Execution:**
- [x] `backend/src/services/significance.js` — Implement two-proportion z-test: `z = (p1 - p2) / sqrt(p_hat * (1 - p_hat) * (1/n1 + 1/n2))`, compute p-value from z-score via normal CDF approximation (error function). Export `computeWinner(segments, minRatedThreshold)` returning `{ state: 'declared' | 'insufficient_data' | 'tie', winnerPromptVersion?: string, pValue?: number, reason?: string }`.
- [x] `backend/src/functions/sat-analytics.js` — Import `computeWinner`, read `SAT_MIN_RATED_THRESHOLD` from env (default 10), call after segment aggregation, attach winner to response body.
- [x] `frontend/src/pages/director/SatAnalytics.js` — After SAT score cell, add a column "Ganador" that shows a green checkmark badge for `declared`, a muted "Insuficiente" badge for `insufficient_data`, or a yellow "Empate" badge for `tie`. Use payload's `winner` field.
- [x] `frontend/src/services/api.js` — Update mock data to include `winner: { state: 'insufficient_data', reason: 'insufficient_data_both' }` in the SAT analytics mock response.
- [x] `backend/src/services/telemetry.js` — Add optional `winnerDeclared` string property to `trackRAGInteraction()` and pass it through to properties.

**Acceptance Criteria:**
- Given a subject with >1 prompt versions where one version has >=SAT_MIN_RATED_THRESHOLD ratings and a statistically significant higher satScore (p < 0.05), when GET /api/sat-analytics is called, then response includes `winner: { state: "declared", winnerPromptVersion: "...", pValue: <number> }`.
- Given a subject where all prompt versions have fewer than SAT_MIN_RATED_THRESHOLD ratings, when GET /api/sat-analytics is called, then `winner.state` is `"insufficient_data"` with reason `"insufficient_data_both"`.
- Given a subject with exactly one prompt version with ratings, when GET /api/sat-analytics is called, then `winner.state` is `"insufficient_data"` with reason `"single_segment"`.
- Given the Director SAT Analytics page with a response containing `winner.state: "declared"`, then the UI shows a green badge next to the winning prompt version.
- Given the Director SAT Analytics page with a response containing `winner.state: "insufficient_data"`, then all segments show a muted "Insuficiente" badge.

## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. -->

## Design Notes

**Two-proportion z-test formula:**
```
p1 = positive1 / n1
p2 = positive2 / n2
p_hat = (positive1 + positive2) / (n1 + n2)
se = sqrt(p_hat * (1 - p_hat) * (1/n1 + 1/n2))
z = (p1 - p2) / se
p_value = 2 * (1 - Phi(|z|))  // two-tailed, Phi via erf
```

Only the top-2 segments by `satScore` (among those meeting min threshold) are compared. If fewer than 2 segments meet the threshold, winner is `insufficient_data`.

**Known limitation:** Current A/B assignment is per-request random (not per-user sticky). This inflates variance. Sticky user-to-prompt assignment is deferred but documented for future A/B quality improvement.

**Winner telemetry:** The `RAGInteraction` event gains a `winnerDeclared` property when a winner is active, so dashboards can correlate interaction volume with winner status over time.

## Verification

**Commands:**
- `npm --prefix backend test` — expected: existing tests pass, new significance tests pass
- `npm --prefix frontend test` — expected: existing tests pass

**Manual checks:**
- Navigate to Director SAT Analytics page, verify winner badge renders correctly for each state
- Verify that with `SAT_MIN_RATED_THRESHOLD=0` (dev override) significance works without min threshold
