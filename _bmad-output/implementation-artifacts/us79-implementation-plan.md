# Implementation Plan: User Story #79

**Feature/Story Name**: Cost-per-Interaction Dashboard  
**Status**: In Progress  
**Business Impact**: Direction can supervise AI operating cost per interaction with transparent formulas, enabling faster FinOps decisions before monthly overspend accumulates.

## Requirements & Constraints Analysis
- Director story requests an Azure Workbook that shows exact interaction cost behavior using pricing rules:
  - Input: **$0.15 / 1M tokens**
  - Output: **$0.60 / 1M tokens**
- Dashboard must fluctuate with usage, so cost outputs should be tied to real telemetry rows (SessionMetrics and App Insights).
- Must preserve zero-trust posture and avoid introducing hardcoded secrets.
- Existing project already has workbook scaffolding and director telemetry views; plan focuses on correctness and visibility of formulas across IaC and UI.

## Edge Cases Considered
- Empty or low-volume periods must still render stable values (cost = 0 without division errors).
- Anonymous interactions should not inflate DAU while still contributing to cost totals.
- Missing prompt/completion token fields in historical rows should gracefully fallback to zero.
- Workbook data source miswiring (App Insights vs Log Analytics resource IDs) can silently break query rendering.

## Planned Milestones
- [ ] Validate and harden workbook data source wiring to the correct App Insights resource.
- [ ] Add backend aggregation for cost-per-interaction using the required pricing formulas.
- [ ] Expose pricing constants and summary totals in director metrics API for transparent verification.
- [ ] Upgrade director dashboard to display cost KPIs and per-day cost fluctuation.
- [ ] Add/extend tests for IaC formula integrity and API cost calculations.
- [ ] Run backend tests plus Chrome Playwright usability verification.
- [ ] Publish walkthrough artifact with verification evidence and acceptance mapping.

## Out of Scope
- Budget threshold alerting logic.
- Cost forecasting beyond current observed window.
- Prompt-level profitability recommendations.
