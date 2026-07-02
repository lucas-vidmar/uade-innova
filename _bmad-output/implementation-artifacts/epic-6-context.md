# Epic 6 Context: Director Analytics & Operational Intelligence

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Directors monitor pilot adoption, costs, and student engagement through actionable KPIs. Daily aggregated metrics surface budget burn (target $97.50/mo total, $1.50/student), anonymized at-risk student signals, and one-click PDF exports for stakeholder reporting. Covers FR49–FR58.

## Stories

- Story 6.1: Adoption and Cost Dashboard
- Story 6.2: Student Intervention Signals
- Story 6.3: Compliance Export

## Requirements & Constraints

- Director dashboard must show weekly active users by subject, material upload frequency by teacher, cost per subject (30d), and average cost per student
- Budget warnings at 80% ($78) projected usage (yellow) and 95% (red alert)
- Student risk heuristics: no login 7d = low, no login 14d or <2 queries/7d = medium, no login 21d and <5 queries/14d = high
- Intervention signals show anonymized student ID, risk level, reason, and suggested action
- Compliance export generates PDF with anonymized usage stats, adoption trends, cost summary, and data governance statement
- All KPIs filterable by subject and date range
- No PII in exported data or dashboards

## Technical Decisions

- **Analytics storage:** App Insights custom events (RagQuery.Executed, MaterialUpload, Correction.Reported) with properties (userId, subjectId, cost, latency). No additional storage service needed.
- **Daily aggregation:** Timer-triggered Function `analytics/aggregate-metrics` runs daily, executes KQL over App Insights.
- **Cost tracking:** Each Function emits `costUsd` in custom event properties. Cost per query/student derived from aggregated KQL.
- **Student signals:** `UserEvents` Table (PartitionKey=userId) stores login and query events queried by the aggregation Function.
- **Export:** POST `/api/analytics-export` generates PDF server-side (libreria jsPDF or similar).
- **Frontend:** `frontend/src/pages/director/dashboard.js` and `analytics-view.js` — KPI cards, line charts, bar charts. No charting library dependency confirmed; use Canvas API or lightweight alternative.
- **Budget threshold constants:** `BUDGET_MONTHLY = 97.50`, `WARNING_THRESHOLD = 0.80`, `ALERT_THRESHOLD = 0.95`.

## UX & Interaction Patterns

- Director dashboard: full-width, 2-column layout (KPI card row + charts). KPI cards: Active Students, Messages Today, Avg Response Time, Top Subject (each with trend arrow/sparkline).
- Charts: line chart (usage over time, brand gradient fill), horizontal bar chart (top queries), donut chart (material coverage by subject). Color tokens: `--color-success` for positive KPIs, `--color-warning` for near-threshold, `--color-error` for alerts.
- Export button triggers PDF generation with system loading state.

## Cross-Story Dependencies

- 6.1 depends on RagQuery custom events emitted by Epic 3's `rag-query` Function (FR31, FR61) and MaterialUpload events from Epic 2.
- 6.2 depends on UserEvents table (populated by login/query events from Epics 1 and 3).
- 6.3 depends on 6.1 metrics being available (same aggregation pipeline).
- All stories depend on App Insights being provisioned (Epic 9 / existing infra).
