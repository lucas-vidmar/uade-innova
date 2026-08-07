---
title: 'Vacíos Temáticos Dashboard — dedicated thematic gaps view in teacher analytics'
type: 'feature'
created: '2026-08-06'
status: 'in-progress'
review_loop_iteration: 1
baseline_commit: '7a13b74'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
---

# Vacíos Temáticos Dashboard — dedicated thematic gaps view in teacher analytics

## Intent

**Problem:** Teachers cannot identify which topics students struggle with most (high-friction topics with low class coverage), so reinforcement happens reactively. QA Flow 13 (Partial) confirms friction-topic detection exists (`frictionTopics`) but lacks a dedicated visualization correlating friction × coverage × query volume.

**Approach:** Add a "Vacíos Temáticos" card to the Teacher Analytics page that scores each friction topic with `gapScore = unresolvedRatio × normalizedVolume × (0.5 + lowCoverage)`, color-codes severity, and expands on click to show related student queries and suggested class topics to reinforce. Pure frontend — reuses existing `frictionTopics`, `classViews`, `topQuestions`, and `classes` data.

## Boundaries & Constraints

**Always:**
- Card lives inside the existing `renderTeacherAnalytics` flow on `frontend/src/pages/teacher/Analytics.js` (teacher role-guarded by existing router).
- Scoring is computed client-side from already-fetched data (`frictionTopics`, `topQuestions`, `classes`, `classViews`). No new backend endpoint.
- Severity thresholds: green (unresolved ratio < 0.30), yellow (0.30–0.60), red (> 0.60).
- `gapScore = unresolvedRatio × normalizedVolume × (0.5 + lowCoverage)`; volume normalized to [0,1] by max queries across topics; coverage = fraction of class schedule topics that mention the friction topic.
- Click-to-expand surfaces: (a) related student queries (topQuestions whose text shares tokens with the gap topic), (b) suggested class topics to reinforce (topics from classes that are relevant to the gap but not covered).
- Add `id="teacher-gaps-card"` container with `data-severity` attributes for E2E assertions.
- Reuse existing `.card`, `.card-header`, `.badge`, `.progress-bar` patterns and CSS variables.
- New E2E test added to `frontend/tests/teacher-alerts.spec.js` (existing analytics route mocks).

**Ask First:**
- None expected. If scoring behavior conflicts with existing friction-topic semantics, HALT and ask before re-deriving.

**Never:**
- Do not create a new backend endpoint or modify `analytics.js` backend function.
- Do not add new npm dependencies.
- Do not alter the existing friction-topic / top-question cards.
- Do not change student-facing views.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| NO_FRICTION | `frictionTopics` empty | Empty-state message inside gaps card | N/A |
| NO_CLASSES | `classes` empty | `lowCoverage` defaults to 1 (maximal gap weight) | N/A |
| ZERO_QUERIES | topic with `queries: 0` | Ratio 0 → green, score 0; topic still listed | Guard division by zero |
| NO_MATCHING_TOPIC | friction topic token not found in any class topic | Coverage 0 → full low-coverage weight | N/A |
| EXPAND | click on gap row | Related queries + suggested topics render; second click collapses | N/A |
| LOW_VOLUME | volume 0.1 | Score weighted low despite high ratio | N/A |

## Code Map

- `frontend/src/pages/teacher/Analytics.js` — Add `computeThematicGaps()` scoring function + gaps card markup inside `renderTeacherAnalytics` (after friction topics grid).
- `frontend/src/styles/pages.css` — Add `.gap-item`, `.gap-severity-*`, `.gap-expand`, `.gap-query-list`, `.gap-suggested-topics` styles near existing `.friction-item` block.
- `frontend/tests/teacher-alerts.spec.js` — Add `teacher sees thematic gaps card with correct severity` test reusing analytics/classes/class-views route mocks.

## Tasks & Acceptance

**Execution:**
- [ ] `frontend/src/pages/teacher/Analytics.js` — `computeThematicGaps(frictionTopics, classes, classViews)` returns ranked gaps with `topic`, `unresolvedRatio`, `volume`, `coverage`, `score`, `severity`.
- [ ] `frontend/src/pages/teacher/Analytics.js` — gaps card renders ranked list, severity badge, progress bar, click-to-expand with related queries + suggested topics.
- [ ] `frontend/src/styles/pages.css` — gap card styles.
- [ ] `frontend/tests/teacher-alerts.spec.js` — E2E test asserting card render, severity badge, and expand behavior.

**Acceptance Criteria:**
- Given a teacher with friction data, when Analytics loads, then the "Vacíos Temáticos" card renders showing intersection of high-friction topics × low class coverage × high query volume.
- Given a gap, when it renders, then severity is color-coded (green/yellow/red) based on unresolved query ratio.
- Given a gap, when clicked, then related student queries and suggested class topics are shown.
- Given friction data present, then the card uses only existing `frictionTopics`, `classViews`, `topQuestions` and `classes` — no new endpoint.
- Given the E2E suite, then the gaps-card test passes.

## Spec Change Log

- `2026-08-06 (initial)` — Created from GitHub issue #213.

## Verification

**Commands:**
- `cd frontend && npx playwright test tests/teacher-alerts.spec.js` — expected: new gaps test + existing alert tests pass.
- `cd frontend && npm run build` — expected: production build succeeds.

## Suggested Review Order

**Scoring logic**

- `computeThematicGaps()` — gapScore formula and severity thresholds.
  [`Analytics.js`](../../frontend/src/pages/teacher/Analytics.js)

**Rendering**

- Gaps card markup — severity badge, progress bar, expand interactions.
  [`Analytics.js`](../../frontend/src/pages/teacher/Analytics.js)

- Gap card CSS — severity colors and expandable panel.
  [`pages.css`](../../frontend/src/styles/pages.css)

**Tests**

- E2E gaps-card test — render, severity, expand.
  [`teacher-alerts.spec.js`](../../frontend/tests/teacher-alerts.spec.js)
