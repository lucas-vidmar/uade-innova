# Acceptance Auditor Review — Spec gh-178

You receive the diff, the spec file at `_bmad-output/implementation-artifacts/spec-gh-178-retention-compliance-evidence-export.md`, and read access to the project at `/Users/lucasvidmar/Documents/azure-educational-dashboard`.

Also read the context docs listed in the spec frontmatter:
- `_bmad-output/implementation-artifacts/epic-6-context.md`
- `_bmad-output/implementation-artifacts/6-2-student-intervention-signals.md`

Verify against each Acceptance Criterion:

**AC1:** "Given I am a Director, when I visit the compliance page, then I see a table of lifecycle policy rules with name, action, retention days, and prefixes"
- Check the Compliance.js page renders all required columns
- Check it handles the null/missing policy case

**AC2:** "Given I am on the compliance page, when I click Exportar CSV, then a CSV file downloads with all policy rules and generated timestamp"
- Check the download mechanism
- Check CSV content includes all required fields

**AC3:** "Given I am on the compliance page, when I click Exportar JSON, then a JSON file downloads with the same data"
- Check JSON structure

**AC4:** "Given the retention policy config blob exists, when GET /api/compliance/retention-policy is called, then it returns the full policy summary"
- Check the API endpoint returns the correct data shape

**AC5:** "Given a non-Director requests either endpoint, when the request is processed, then a 403 is returned"
- Check auth guard is applied to both endpoints

**AC6:** "Given an export succeeds, when the telemetry event fires, then a ComplianceExport event is logged in App Insights"
- Check telemetry call exists on export

Also check the spec's Always constraints:
- No secrets or storage keys exposed
- Director role required for both endpoints
- CSV as text/csv, JSON as application/json pretty-printed
- Export includes policy rules + generated timestamp
