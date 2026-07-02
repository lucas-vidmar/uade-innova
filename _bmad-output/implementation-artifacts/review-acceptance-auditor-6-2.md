# Acceptance Auditor Review — Story 6.2 (Student Intervention Signals)

You have the diff, the spec, and read access to the project. Verify the implementation satisfies all acceptance criteria and follows project conventions.

## Diff

Files changed: same as blind hunter review file.

## Spec

Loaded from `_bmad-output/implementation-artifacts/spec-6-2-student-intervention-signals.md`

## Context docs (from spec frontmatter)

- `_bmad-output/implementation-artifacts/epic-6-context.md`
- `_bmad-output/implementation-artifacts/6-1-adoption-and-cost-dashboard.md`

## Project-context rules to verify

From `_bmad-output/project-context.md`:
- Backend: JavaScript ES Modules, kebab-case file naming, camelCase functions
- Frontend: Vanilla JS, no frameworks, no charting libraries (Canvas API)
- Auth: Director guard pattern (principal?.userRoles?.some)
- API response format: { success, data, meta: { timestamp } } pattern
- CSS variables for all colors

## Instructions

Check each acceptance criterion:

1. **Given risk computation runs, when a student has no login 14d and <2 queries/7d, then an intervention record is created with risk=medium**
   - Does computeRisk in interventions-api.js produce medium risk for this input?
   - Does the POST /api/interventions/compute endpoint store it?

2. **Given I am a Director, when I visit the Intervenciones page, then I see a table of at-risk students**
   - Does the Interventions.js render a table?
   - Are student IDs anonymized (no PII)?
   - Are risk level, reason, and workflow state visible?

3. **Given I click an intervention row, when the detail modal opens, then I can transition state**
   - Does the modal have state transition buttons?
   - Does PUT update the intervention and return updated state?

4. **Given I resolve an intervention, when the active queue loads, then it is excluded**
   - Does GET /api/interventions support ?state= filter?
   - Is the default view filtered to exclude resolved?

5. **Given I open threshold config, when I change a threshold and save, then it persists**
   - Does PUT /api/risk-thresholds store and return the updated config?

Also verify:
- Mock code removed from sga-api.js (computeRiskFlags, buildMockEarlyAlerts)
- Route registered in main.js and Sidebar.js
- Dashboard.js has link to interventions page
- All new endpoints have Director auth guard
- No PII exposed

Return a numbered list of any violations found.
