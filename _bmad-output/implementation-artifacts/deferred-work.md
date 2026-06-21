# Deferred Work

Issues surfaced during review that are pre-existing or out of scope for the current story.

## Findings

1. **Pagination on sat-analytics endpoint** — `listEntities` lacks continuation token handling; large datasets will heap OOM.
2. **Event listener leak on SatAnalytics page** — Each navigation re-attaches listeners without cleanup; memory leak + duplicate API calls.
3. **Race condition on rapid filter clicks** — No inflight token; stale responses can overwrite newer filtered data.
4. **Blob path sanitization in chat-api.js** — `subjectId`/`messageId` from request body used directly in blob path for chat log lookup; path traversal risk.
5. **No `.ok` check before `res.json()` in api.js** — Pre-existing pattern across multiple endpoints; 4xx/5xx responses not handled gracefully.
6. **`createdAt` field semantics** — `Merge` upsert overwrites timestamp on re-rating; field name is misleading.

## Deferred from: code review of 10-6-split-api-into-domain-modules (2026-06-21)

- `ragQueryStream` has no `signal`/cancellation support — `subscribeNotificationStream` has it but rag stream does not; pre-existing
- `deleteSubject` uses `new URL()` on relative `BASE_URL` — throws in production when `BASE_URL='/api'`; pre-existing
- Seven functions bypass mock mode (`getGlossary`, `updateGlossary`, `getTranscriptionSuggestions`, `applyTranscriptionCorrection`, `rejectTranscriptionSuggestion`, `getSubjectWeights`, `saveSubjectWeights`) — pre-existing; no `if (USE_MOCK)` branch
- Mock-data subject-ID mismatch: `arq-soft-2026` vs `arq-software-2026` — seeded subject ID doesn't match mock data IDs; pre-existing
- `MOCK_CLASSES` dead export in `mocks/data.js` — never imported by any module; pre-existing dead data
- `getSatAnalytics` mock always-empty dead logic — `segments.filter(() => false)` always returns `[]`; pre-existing
- Inconsistent mock-return shapes across `save*` functions — some return `undefined`, some return payload; pre-existing
- `getDirectorKpiExport` non-mock branch tautology — both branches `return res.blob()`; pre-existing
- `ingestMaterial` dead `USE_MOCK` check inside `!res.ok` block — pre-existing unreachable disjunct
- No `encodeURIComponent` on path-parameter IDs in `classes.api.js` and `materials.api.js` — pre-existing; inconsistent encoding within same module
- Public surface widened — `api` object now exposes core helpers (`apiFetch`, `fetchWithTimeout` etc.); additive, not regression
- CSV export mocks don't escape commas/quotes — pre-existing CSV injection risk in `admin.api.js`
- `core.js` accesses `window`/`crypto` at module top level — pre-existing; wider blast radius now that core.js is imported by 10 modules
- `getCorrection` return type differs mock vs non-mock — mock returns object, non-mock returns array when no `correctionId`; pre-existing
- `generateSpanId` no `crypto` guard — `fallbackUuid` guards but `generateSpanId` does not; pre-existing
- `saveClass`/`deleteClass`/`getRetentionExport` bypass `this.` overrides — inherent consequence of moving from object methods to standalone functions; no current code monkey-patches `api`
