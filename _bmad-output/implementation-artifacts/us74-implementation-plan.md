# Implementation Plan: User Story #74

**Feature/Story Name**: End-to-End Distributed Tracing (Correlation-ID)  
**Status**: In Progress  
**Business Impact**: Enables deterministic request tracing from Static Web App to backend functions and Azure OpenAI dependencies, reducing MTTR for production incidents and improving observability confidence.

## Requirements & Constraints Analysis
- Propagate a unique `Correlation-ID` from SWA (frontend) to backend APIs.
- Ensure backend propagates the same identifier to Azure OpenAI client calls.
- Maintain compatibility with existing request flows (JSON, multipart upload, SSE streaming).
- Avoid hardcoded secrets and preserve current Zero-Trust posture.
- Keep behavior resilient for local dev where tracing backends may be unavailable.

## Edge Cases Considered
- Incoming requests without `x-correlation-id` header → backend must generate one.
- Invalid/malicious header values (empty, overlong, unsupported characters) → sanitize/fallback to generated UUID.
- Streaming endpoint (`/api/rag-query` with SSE) must still expose correlation context.
- Legacy callers that don’t use shared frontend API helpers should still get backend-generated IDs.
- Error responses should include the correlation ID to support triage.

## Planned Milestones
- [ ] Add shared correlation utilities in backend (resolve, sanitize, outbound headers).
- [ ] Update backend OpenAI service wrappers to accept and forward correlation headers.
- [ ] Wire correlation propagation in RAG and search endpoints (request parse, logs, response headers).
- [ ] Add frontend API transport helper to inject `x-correlation-id` on all outbound API calls.
- [ ] Add backend unit tests validating correlation handling and OpenAI propagation.
- [ ] Add Playwright Chromium usability test validating browser request propagation.
- [ ] Run backend + frontend test suites and capture verification evidence.
- [ ] Produce walkthrough artifact + backlog refinement notes.

## Out of Scope
- Cross-service W3C traceparent stitching in Azure Monitor.
- Correlation visualization dashboard/workbook.
- Additional dependency propagation beyond Azure OpenAI for this story.
