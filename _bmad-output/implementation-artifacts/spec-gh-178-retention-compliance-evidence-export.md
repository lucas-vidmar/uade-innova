---
title: 'Story 6.3 — Director Retention Compliance Evidence Export'
type: 'feature'
created: '2026-06-19'
status: 'done'
baseline_commit: 'a77954dfe78a5a2982e253aee2ec1c0be1a3e4be'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/6-2-student-intervention-signals.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Directors and security officers have no way to verify blob lifecycle retention/disposal compliance without accessing Azure Portal. Regulatory audits require downloadable evidence of policy enforcement.

**Approach:** Add a Director-only API endpoint that returns the effective lifecycle policy from a stored config, and a dashboard export action that generates a downloadable CSV/JSON evidence file with policy rules, prefixes, retention thresholds, and timestamp.

## Boundaries & Constraints

**Always:**
- Policy data sourced from a JSON blob (`compliance/retention-policy.json`) stored in Blob Storage — not from Azure Management API (no management-plane RBAC)
- `DELETE /api/compliance/retention-policy` returns current policy summary: rule names, prefixMatch arrays, action type (delete/archive), retention days, last evaluation timestamp
- `GET /api/compliance/retention-export?format=csv|json` returns downloadable compliance evidence with policy rules + generated timestamp
- Export must be human-readable: CSV as text/csv with header row, JSON as application/json pretty-printed
- Director role required for both endpoints
- Export action logs telemetry event `ComplianceExport` with format, timestamp, and user ID
- Retention-policy config blob seeded via deployment script or manual upload
- No secrets or storage keys exposed in any response

**Ask First:**
- Whether the retention-policy config should be seeded via the seed-pinecone.js script or a separate seed-retention-policy.js script
- Whether the compliance page should be a full new page or a section within the existing director dashboard

**Never:**
- No PII in exported data; no Azure Management API calls; no charting libraries; no PDF generation (keep it simple with CSV/JSON)

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Director requests policy summary | `GET /api/compliance/retention-policy` with Director role | 200 JSON: `{ rules: [{ name, enabled, action, retentionDays, prefixes }], softDeleteDays: 7, evaluatedAt }` | N/A |
| Director requests CSV export | `GET /api/compliance/retention-export?format=csv` | 200 `text/csv` with header: `rule_name,enabled,action,retention_days,prefixes` + row per rule + `generated_at` footer | N/A |
| Director requests JSON export | `GET /api/compliance/retention-export?format=json` | 200 `application/json` with `{ export: { rules: [...], softDeletePolicy, generatedAt } }` | N/A |
| Policy config blob missing | Blob `compliance/retention-policy.json` does not exist | N/A | 503: "Retention policy configuration not found" |
| Non-Director role | Request with Student or Teacher role | N/A | 403: "Forbidden - Director access required" |
| Invalid format param | `GET /api/compliance/retention-export?format=pdf` | N/A | 400: "Unsupported format. Use 'csv' or 'json'" |
| Export telemetry failure | Export succeeds but telemetry send fails | Export still returned successfully | Logged via `context.error`, no user-facing error |

</frozen-after-approval>

## Code Map

- `backend/src/functions/compliance-api.js` — New file: retention-policy GET + retention-export GET endpoints
- `backend/src/index.js` — Register compliance function imports
- `frontend/src/pages/director/Compliance.js` — New page: compliance evidence table + export buttons
- `frontend/src/pages/director/Dashboard.js` — Add link to compliance page
- `frontend/src/services/api.js` — Add getRetentionPolicy, getRetentionExport methods
- `frontend/src/main.js` — Register `/director/compliance` route
- `frontend/src/components/Sidebar.js` — Add nav item for compliance page
- `scripts/seed-retention-policy.js` — New script: upload retention-policy.json to Blob Storage

## Tasks & Acceptance

**Execution:**
- [x] `scripts/seed-retention-policy.js` — Script that uploads `retention-policy.json` to `compliance/` container with lifecycle rules matching Bicep definition
- [x] `infra/modules/storage.bicep` — Add `compliance` container for retention policy config blob
- [x] `backend/src/functions/compliance-api.js` — Implement `GET /api/compliance/retention-policy` (returns stored policy) and `GET /api/compliance/retention-export` (returns CSV or JSON download) with Director auth guard and telemetry
- [x] `backend/src/index.js` — Import and register compliance function
- [x] `frontend/src/services/api.js` — Add `getRetentionPolicy()` and `getRetentionExport(format)` client methods
- [x] `frontend/src/pages/director/Compliance.js` — Retention policy overview table (rule name, action, retention days, prefixes) + export buttons for CSV and JSON
- [x] `frontend/src/pages/director/Dashboard.js` — Add "Cumplimiento" action link in the navigation section
- [x] `frontend/src/main.js` — Add `/director/compliance` route
- [x] `frontend/src/components/Sidebar.js` — Add "Cumplimiento" nav item under director section

**Acceptance Criteria:**
- Given I am a Director, when I visit the compliance page, then I see a table of lifecycle policy rules with name, action, retention days, and prefixes
- Given I am on the compliance page, when I click "Exportar CSV", then a CSV file downloads with all policy rules and generated timestamp
- Given I am on the compliance page, when I click "Exportar JSON", then a JSON file downloads with the same data
- Given the retention policy config blob exists, when GET /api/compliance/retention-policy is called, then it returns the full policy summary
- Given a non-Director requests either endpoint, when the request is processed, then a 403 is returned
- Given an export succeeds, when the telemetry event fires, then a ComplianceExport event is logged in App Insights

## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. -->

## Design Notes

Retention policy config blob format (`compliance/retention-policy.json`):
```json
{
  "softDeleteDays": 7,
  "rules": [
    {
      "name": "DeleteArchiveAfter2Years",
      "enabled": true,
      "action": "delete",
      "retentionDays": 730,
      "prefixes": ["class-materials/", "processed/"]
    },
    {
      "name": "ArchiveOldSemesterMaterials",
      "enabled": true,
      "action": "tierToArchive",
      "retentionDays": 180,
      "prefixes": ["class-materials/semester-", "processed/semester-"]
    }
  ]
}
```

## Suggested Review Order

**Backend API — compliance endpoints**

- New Director-only API returning retention policy + CSV/JSON export with auth guard and telemetry
  [`compliance-api.js:1`](../../backend/src/functions/compliance-api.js#L1)
- Director auth guard pattern applied to both endpoints
  [`compliance-api.js:18`](../../backend/src/functions/compliance-api.js#L18)
- Policy missing returns 503, invalid format returns 400
  [`compliance-api.js:46`](../../backend/src/functions/compliance-api.js#L46)
- CSV builder creates header + rule rows + soft-delete + timestamp footer
  [`compliance-api.js:6`](../../backend/src/functions/compliance-api.js#L6)

**Frontend — Compliance page**

- Compliance page renders policy table with name, action, retention days, prefixes + export buttons
  [`Compliance.js:1`](../../frontend/src/pages/director/Compliance.js#L1)
- Button click handlers download CSV/JSON blobs via temporary anchor elements
  [`Compliance.js:97`](../../frontend/src/pages/director/Compliance.js#L97)

**Frontend — API client (mock + real)**

- Mock data mirrors real policy shape for offline dev
  [`api.js:1967`](../../frontend/src/services/api.js#L1967)
- Export method returns Blob for download, falls back to mock
  [`api.js:1977`](../../frontend/src/services/api.js#L1977)

**Frontend — registration**

- Route added for `/director/compliance`
  [`main.js:36`](../../frontend/src/main.js#L36)
- Nav item "Cumplimiento" with shield icon in director section
  [`Sidebar.js:31`](../../frontend/src/components/Sidebar.js#L31)
- Dashboard link "Cumplimiento →" in early alert section
  [`Dashboard.js:223`](../../frontend/src/pages/director/Dashboard.js#L223)

**Infrastructure**

- New `compliance` blob container in Bicep + output
  [`storage.bicep:88`](../../infra/modules/storage.bicep#L88)

**Seed script**

- Script uploads retention-policy.json matching Bicep lifecycle rules
  [`seed-retention-policy.js:1`](../../scripts/seed-retention-policy.js#L1)

## Verification

**Commands:**
- `node --experimental-test-module-mocks --test src/functions/compliance-api.test.js` — all tests pass

**Manual checks:**
- Navigate to director dashboard → click "Cumplimiento" → verify policy table renders with correct rules
- Click "Exportar CSV" → verify downloaded file opens in spreadsheet with correct columns
- Click "Exportar JSON" → verify downloaded file parses correctly
