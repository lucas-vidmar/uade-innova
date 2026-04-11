# Implementation Plan: User Story #77

**Feature/Story Name**: Vector Search Performance Metrics (Azure AI Search)  
**Status**: In Progress  
**Business Impact**: Operations can separate retrieval latency from LLM latency in Application Insights, improving bottleneck diagnosis and FinOps optimization.

## Requirements & Constraints Analysis
- Story requires **isolated telemetry** for vector-search latency (independent of OpenAI chat latency).
- Acceptance criteria requires dependency-style instrumentation around Azure AI Search vector queries.
- Telemetry payload must include at least `provider` and `index` fields for downstream KQL slicing.
- Implementation must remain compatible with current local environments (no App Insights connection string).

## Edge Cases Considered
- App Insights not configured locally (`APPLICATIONINSIGHTS_CONNECTION_STRING` missing): telemetry must no-op without breaking retrieval.
- Azure AI Search query failure: failed dependency call must still be emitted with error result code.
- Empty result sets: telemetry should still report successful retrieval latency.
- Future extensibility: allow dependency tracker injection for tests and alternative telemetry sinks.

## Planned Milestones
- [ ] Add a dedicated telemetry helper to emit vector-search dependency latency in App Insights.
- [ ] Wrap Azure AI Search query execution in an injectable dependency-tracking wrapper.
- [ ] Ensure provider/index fields are emitted in telemetry properties.
- [ ] Add backend unit tests for success and failure dependency telemetry paths.
- [ ] Add a Chrome Playwright usability test that validates student chat flow remains usable after instrumentation.
- [ ] Execute backend unit tests and targeted frontend Playwright test.
- [ ] Close issue #77 and update walkthrough artifact.

## Out of Scope
- Building dashboards/workbooks for telemetry visualization.
- Instrumenting non-vector Azure Search operations (index create/upsert) in this story.
