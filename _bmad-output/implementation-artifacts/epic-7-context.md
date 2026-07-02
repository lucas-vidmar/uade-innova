# Epic 7 Context: Platform Observability

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

The platform emits structured telemetry from every Azure Function, exposes real-time and historical metrics for RAG latency and vector index health, and alerts administrators to budget overruns and performance anomalies. This enables operational awareness, incident root-cause analysis via materialId/classId correlation, and FinOps control to keep per-student costs under $1.50/mo during the pilot.

## Stories

- Story 7.1: RAG Latency and Custom Metrics
- Story 7.2: Vector Health and Budget Alerts

## Requirements & Constraints

Emit structured Application Insights logs from every Azure Function. Every error log must carry the correlating `materialId`, `classId`, or `userId` to enable debugging by entity. Expose P95 latency per endpoint (targets: chat RAG < 3s, read endpoints < 500ms, ingest < 5s). Expose a `/api/vector-health` endpoint returning index fullness, vector count, search latency P95, and failure ratio. Generate alerts when projected monthly Azure spend exceeds 90% of budget ($87.75 of $97.50); escalate at 95%. All RAG queries must be auditable with `userId`, `timestamp`, `subjectId`, and `sources`. Verify connectivity to Pinecone, Azure OpenAI, and Blob Storage from the health endpoint. Target 99.5% platform uptime measured via App Insights.

## Technical Decisions

**Observability store:** Azure Application Insights (already deployed via `infra/modules/appinsights.bicep`) — no additional provisioned resources. Custom events emitted by each Function at key lifecycle points.

**Event naming convention:** `Domain.Action` in PascalCase — e.g. `RagQuery.Executed`, `Material.Uploaded`, `Correction.Reported`, `IngestMaterial.Failed`. Every custom event includes camelCase properties: `userId`, `subjectId`, and domain-specific fields (`latencyMs`, `costUsd`, `materialId`, `sourcesCount`).

**Cost tracking:** Each Function that calls an LLM or Pinecone emits a `costUsd` property in its custom event. A daily Timer Function (`functions/analytics/aggregate-metrics`) queries App Insights via KQL to compute per-subject and per-student costs.

**Latency breakdown (RAG query):** The `rag-query` Function emits a single `RagQuery.Executed` event with four latency sub-metrics: `embeddingLatencyMs`, `vectorSearchLatencyMs`, `llmFirstTokenLatencyMs`, `llmTotalLatencyMs`, and `totalLatencyMs`.

**Error log pattern:** Every `catch` block in every Function must log at minimum: `functionName`, `error.message`, `error.stack`, the entity ID in context (`materialId`, `classId`, or `userId`), and `requestId` (from `context.invocationId`). Response format follows the standard `{ success: false, error: { code, message } }` contract.

**Budget alerts:** A daily process (Timer Function or external monitor) checks Azure Cost Management API. When projected spend exceeds 90% of monthly budget, an email alert fires. When it exceeds 95%, an escalated alert fires with top cost drivers.

**Vector health endpoint:** `GET /api/vector-health` returns index fullness percent, total vector count, search latency P95 (from last 5 minutes of `RagQuery.Executed` events), and failure ratio from the last hour.

**KQL-based analytics:** Custom events are queried via Application Insights KQL. Example pattern:
```kusto
customEvents
| where name == "RagQuery"
| summarize count(), avg(todouble(customDimensions.costUsd)) by bin(timestamp, 1d), customDimensions.subjectId
```

## Cross-Story Dependencies

Both stories depend on Epic 9 (App Insights resource already provisioned in Bicep). Story 7.1 requires every other epic's Azure Functions to emit custom events — instrumentation must be added to `ingest-material`, `rag-query`, and all new Functions built in Epics 2–6. Story 7.2 depends on the Cost Management API being accessible from the subscription and on the `/api/vector-health` Function being deployed alongside the Pinecone client. Budget alert thresholds are shared with Epic 6 cost dashboard metrics.
