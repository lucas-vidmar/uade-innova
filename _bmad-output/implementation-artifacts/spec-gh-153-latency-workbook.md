---
title: 'App Insights workbook for vector vs LLM latency percentiles'
type: 'feature'
created: '2026-06-19'
status: 'done'
route: 'one-shot'
---

## Intent

**Problem:** Operations/FinOps stakeholders lack a dedicated view comparing vector-search latency (Pinecone) and end-to-end RAG latency, making it hard to identify bottlenecks quickly.

**Approach:** Deploy an Azure App Insights workbook as a Bicep module containing side-by-side P50/P95/P99 percentile charts for `dependencies` (vector.search) and `customEvents` (RAGInteraction), with time range, subjectId, and promptVersion filters.

## Suggested Review Order

1. `infra/modules/latency-workbook.bicep` — workbook definition: KQL queries, parameter configuration, chart layout, group container for side-by-side rendering
2. `infra/main.bicep:108` — latency workbook variable (`latencyWorkbookName`)
3. `infra/main.bicep:254-263` — latency workbook module wiring
4. `backend/src/services/latency-workbook-iac.test.js` — IaC tests
