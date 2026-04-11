# Walkthrough: User Story #79

**Feature/Story Name**: Cost-per-Interaction Dashboard  
**Status**: Completed  
**Business Impact**: Directors can now monitor AI spend per interaction with transparent pricing formulas and daily fluctuation, enabling faster operational and FinOps adjustments.

## What Changed
- Improved workbook provisioning reliability by wiring the Workbook module to the **Application Insights component resource ID** instead of the Log Analytics workspace ID.
- Extended director metrics aggregation to compute cost metrics from token usage with the required formulas:
  - Input cost = `promptTokens * 0.00000015`
  - Output cost = `completionTokens * 0.0000006`
  - Total cost and average cost per interaction calculated per day and for the selected period.
- Extended `/api/director/powerbi-metrics` response contract with:
  - `pricing` block (per-million and per-token constants)
  - `summary` block (period totals and average cost per interaction)
  - Daily rows including prompt/output token split and cost fields.
- Updated Director dashboard UI to show:
  - Pricing formulas ($0.15/1M in, $0.60/1M out)
  - Total and average cost KPI cards
  - Daily cost and cost-per-interaction columns in the Power BI telemetry table.
- Added automated safeguards:
  - Backend unit test validating workbook formula constants and App Insights wiring.
  - Backend unit test coverage for API cost aggregation payload.
  - Chrome Playwright usability test validating that a Director can view formulas and fluctuating cost outputs.

## Verification Results
- **Backend tests**: `npm test` (backend) — passed.
- **Frontend Chrome usability test**: `npx playwright test tests/director-powerbi-dashboard.spec.js --project=chromium` — passed.

## Acceptance Criteria Mapping
- **Formulas set up ($0.15/1M in, $0.60/1M out)**: Implemented in workbook KQL and surfaced in director metrics payload/UI.
- **Workbook fluctuates based on usage**: Daily cost and avg-cost values now derive directly from token telemetry rows and vary with input/output volume.

## Backlog Refinement
- Add subject-level and class-level cost slices in director view to support budget accountability by academic unit.
- Add configurable cost anomaly thresholds (for example, cost-per-interaction spikes above baseline).
- Add month-to-date projected spend estimate to anticipate overrun risk before closing cycle.
