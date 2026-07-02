---
title: 'Export anonymized director KPI snapshots'
type: 'feature'
created: '2026-06-20'
status: 'in-progress'
baseline_commit: 1c994b9235ffcac323630dc18c1b6160b807d45c
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Director Dashboard shows adoption, cost, and engagement KPIs but provides no way to export this data as CSV or PDF for stakeholder reporting. Directors must manually transcribe or screenshot metrics, risking data entry errors and PII exposure.

**Approach:** Add an "Exportar KPIs" button to the Director Dashboard that generates a CSV and PDF snapshot of all currently displayed KPIs — adoption rate, DAU, WAUS by subject, cost per subject, early alert aggregates, teacher upload activity — using anonymized aggregate data only (no student PII). Follow the existing compliance export pattern (backend endpoint + frontend download button).

## Boundaries & Constraints

**Always:**
- No student PII in any export — only anonymized aggregates (counts, percentages, averages)
- CSV must be parseable by standard spreadsheet tools (Excel, Google Sheets)
- PDF must include all KPI sections visible on the dashboard in a print-friendly layout
- Export button shows loading state while generating and error toast on failure
- Telemetry event `DirectorKpiExport` captures format, success/failure, and export duration
- Mock data must work when `USE_MOCK = true` (both CSV and PDF)
- The existing 6-3 compliance export (retention policy) must remain untouched

**Ask First:**
- PDF library choice: jsPDF (client-side) vs puppeteer/playwright (server-side) vs HTML-to-print — recommend client-side HTML-to-print for zero dependency cost

**Never:**
- Do not modify the existing compliance export page or its API
- Do not expose individual student IDs, names, emails, or grades
- Do not add new npm dependencies if avoidable; use native browser APIs for PDF (print)

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| CSV export with data | Dashboard has loaded KPI data | Browser downloads `kpi-snapshot-{date}.csv` with all KPIs as rows | Show toast "Error al exportar CSV" |
| PDF export with data | Dashboard has loaded KPI data | Browser opens print dialog or downloads `kpi-snapshot-{date}.pdf` with formatted layout | Show toast "Error al exportar PDF" |
| Export while data is still loading | User clicks export before data resolves | Button shows spinner, waits for data fetch, then generates export | If fetch fails, show error toast |
| No data for some metrics | costBySubject or wausBySubject is empty | Export includes empty sections with "Sin datos" placeholder | N/A |
| Mock mode | USE_MOCK = true | Both CSV and PDF exports work with MOCK_DIRECTOR_STATS data | N/A |

</frozen-after-approval>

## Code Map

- `frontend/src/pages/director/Dashboard.js` -- Add "Exportar KPIs" button (CSV + PDF), CSV generation logic, PDF print trigger
- `frontend/src/services/api.js` -- Add `getDirectorKpiExport(format)` method with mock fallback
- `backend/src/functions/director-kpi-export.js` -- New Azure Function `GET /api/director/kpi-export?format=csv|pdf` returning the export blob
- `backend/src/functions/director-stats.js` -- Existing endpoint; ensure data shape matches export needs

## Tasks & Acceptance

**Execution:**
- [ ] `backend/src/functions/director-kpi-export.js` -- Create Azure Function returning CSV/PDF blob of current KPI stats, with role auth (Director only), telemetry, and error handling
- [ ] `frontend/src/services/api.js` -- Add `getDirectorKpiExport(format)` that calls the new endpoint with mock fallback generating CSV/PDF client-side
- [ ] `frontend/src/pages/director/Dashboard.js` -- Add "Exportar KPIs" dropdown (CSV/PDF), loading state, error handling, download

**Acceptance Criteria:**
- Given I am on the Director Dashboard with KPI data loaded, when I click "Exportar CSV", then a CSV file downloads containing: adoption rate, DAU, WAUS by subject, cost per subject, early alert aggregates, and teacher upload activity — all anonymized, no PII
- Given I click "Exportar PDF", then a print-ready layout opens with all KPI sections formatted for printing
- Given the backend is unreachable, when I click export, then the mock fallback generates the export client-side from the already-fetched dashboard data
- Given an export fails, when the error occurs, then a user-facing error toast is shown with "Error al exportar {formato}" and the error is logged via console.error with context
- Given I am not a Director, when I call the backend endpoint, then it returns 403 Forbidden

## Verification

**Commands:**
- `npm run lint --workspace=frontend 2>/dev/null || true` -- no lint errors
- `npm run lint --workspace=backend 2>/dev/null || true` -- no lint errors
