---
title: 'TTFT Dashboard Segmentation by Subject and Prompt Version'
type: 'feature'
created: '2026-06-20'
status: 'done'
route: 'one-shot'
---

# TTFT Dashboard Segmentation by Subject and Prompt Version

## Intent

**Problem:** Operations engineers lack per-segment TTFT (Time to First Token) visibility broken down by subjectId and promptVersion, making it impossible to identify latency hotspots tied to specific courses or prompt experiments.

**Approach:** Extend the existing latency-percentiles Azure Workbook with dedicated TTFT views that segment P95 latency by subjectId and promptVersion, expose P50/P90/P95 summary tables, and include a minimum-sample-count guard (>2) to suppress empty/low-volume segments without breaking visualization.

## Suggested Review Order

1. `infra/modules/latency-workbook.bicep:211-392` — TTFT by Subject chart + table: P95 time-series split by subjectId, P50/P90/P95 summary table, PromptVersion filter cross-apply, SampleCount guard
2. `infra/modules/latency-workbook.bicep:305-392` — TTFT by Prompt Version chart + table: P95 time-series split by promptVersion, P50/P90/P95 summary table, SubjectId filter cross-apply, SampleCount guard
3. `infra/modules/latency-workbook.bicep:28` — header updated to mention TTFT segmentation
4. `infra/modules/latency-workbook.bicep:388-395` — KQL reference updated with TTFT query documentation
5. `backend/src/services/latency-workbook-iac.test.js:45-85` — 4 new tests: TTFT by subject chart/table, TTFT by prompt version, header mentions, KQL reference docs
