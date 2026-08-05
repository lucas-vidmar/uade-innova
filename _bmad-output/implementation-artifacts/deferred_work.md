# Deferred Work — Archive Tier Dashboard (gh-176)

Items identified during review that are pre-existing patterns not introduced by this story.

## Pre-existing Patterns

| ID | Issue | Justification |
|----|-------|--------------|
| D1 | `AZURE_STORAGE_CONNECTION_STRING` env var — may not exist in environments using `AZURE_STORAGE_ACCOUNT_NAME` + key | Same pattern as `storage-lifecycle.js` throughout the codebase |
| D2 | `authLevel: 'anonymous'` on all HTTP functions | SWA Front Door handles auth upstream; consistent with all other functions |
| D3 | Credential exposure via error message on missing env var | Consistent pattern across all services |
| D4 | No transient fault/retry logic on blob enumeration | Same as all other blob operations |
| D5 | No request timeout in frontend service layer | Pre-existing; not introduced here |
- source_spec: `_bmad-output/implementation-artifacts/spec-11-216-docente-rag-sandbox.md`
  summary: Blocking-path RAG telemetry uses a separate uuidv4() from the response interactionId, so telemetry can't be joined to the chat log in non-streaming mode.
  evidence: Pre-existing pattern in rag-query.js blocking path (lines ~713/743); surfaced while instrumenting sandbox telemetry.
- source_spec: `_bmad-output/implementation-artifacts/spec-11-216-docente-rag-sandbox.md`
  summary: Verified-answer fast path emits no RAGInteraction telemetry at all.
  evidence: Pre-existing — rag-query.js verified-answer branch returns before any trackRAGInteraction call; sandbox previews of verified answers are invisible in App Insights.
- source_spec: `_bmad-output/implementation-artifacts/spec-11-216-docente-rag-sandbox.md`
  summary: AGENTS.md §11 rag-query API contract does not document sandbox/simulateStudent request fields.
  evidence: Pre-existing docs gap; project knowledge should be updated in a separate docs task.
