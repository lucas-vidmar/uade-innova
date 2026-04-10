# Implementation Plan: User Story #75

**Feature/Story Name**: Power BI Analytics Dashboard  
**Status**: In Progress  
**Business Impact**: Directors can consume DAU and token usage from a continuous-export data source, enabling direct Power BI dashboards for operational and FinOps visibility.

## Requirements & Constraints Analysis
- Story requires an interactive Power BI dashboard with **DAU + token consumption**.
- Acceptance criteria allows either:
  - direct connection to Log Analytics, or
  - continuous export to DB.
- Existing implementation already writes per-interaction metrics (`totalTokens`, `userId`, `timestamp`) to Azure Table Storage (`SessionMetrics`) via continuous export pattern.
- Must preserve role-based access and avoid hardcoded credentials.

## Edge Cases Considered
- Empty/missing `SessionMetrics` table in non-prod environments.
- Anonymous interactions should count for token totals but not inflate DAU.
- Invalid timestamps or malformed token values in exported entities.
- Time-window requests outside sensible limits (`days` clamped to 1..90).

## Planned Milestones
- [ ] Implement backend endpoint for Power BI-friendly timeseries (`/api/director/powerbi-metrics`).
- [ ] Reuse exported `SessionMetrics` entities to compute daily DAU + token totals.
- [ ] Surface integration source metadata in director stats payload.
- [ ] Add backend unit tests for authorization and metric aggregation.
- [ ] Add director UI section to display Power BI-ready data table.
- [ ] Add Playwright Chrome usability test validating visibility and rendered metrics.
- [ ] Execute backend and frontend test suites.
- [ ] Document results in walkthrough and propose backlog refinements.

## Out of Scope
- Native embedded Power BI iframe/report publishing in this iteration.
- Subject-level drilldown or cohort segmentation in the exported endpoint.
- Alerting logic (covered by separate anomalous-usage story).
