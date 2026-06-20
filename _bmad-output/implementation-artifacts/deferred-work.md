# Deferred Work

Issues surfaced during review that are pre-existing or out of scope for the current story.

## Findings

1. **Pagination on sat-analytics endpoint** — `listEntities` lacks continuation token handling; large datasets will heap OOM.
2. **Event listener leak on SatAnalytics page** — Each navigation re-attaches listeners without cleanup; memory leak + duplicate API calls.
3. **Race condition on rapid filter clicks** — No inflight token; stale responses can overwrite newer filtered data.
4. **Blob path sanitization in chat-api.js** — `subjectId`/`messageId` from request body used directly in blob path for chat log lookup; path traversal risk.
5. **No `.ok` check before `res.json()` in api.js** — Pre-existing pattern across multiple endpoints; 4xx/5xx responses not handled gracefully.
6. **`createdAt` field semantics** — `Merge` upsert overwrites timestamp on re-rating; field name is misleading.
