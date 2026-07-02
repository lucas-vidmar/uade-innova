# Story 4.3: Verified Answer Boost in RAG

Status: done
baseline_commit: 730726147256b362fb3300215d042841b06e8dd8

## Story

As a student,
I want teacher-verified answers to appear first when I ask similar questions,
so that I get the most accurate information.

## Acceptance Criteria

1. **Given** a verified answer exists in Pinecone (materialType="verified-answer"), **When** I ask a related question, **Then** the RAG pipeline first queries Pinecone for `materialType="verified-answer"` with the question embedding. If similarity > 0.85, returns the verified answer directly with badge: "✅ Respuesta verificada por el docente". If no high-similarity verified answer, falls back to standard material search.

## Tasks / Subtasks

- [x] Task 1: Add verified-answer-first search to RAG pipeline (AC: 1)
  - [x] 1.1 In `rag-query.js`, add a pre-search step: query Pinecone with filter `{ subjectId, materialType: "verified-answer" }` before the standard search
  - [x] 1.2 Use `querySimilar(questionEmbedding, verifiedFilter, 5)` for the verified-only search
  - [x] 1.3 If top verified match score > 0.85, bypass LLM: return the verified answer directly as the response
  - [x] 1.4 Set `verified: true` and `verifiedMetadata` in the response
  - [x] 1.5 If no verified match with score > 0.85, fall through to the existing standard material search unchanged
  - [x] 1.6 Apply verified-first search in both streaming and non-streaming code paths

- [x] Task 2: Show verified badge in chat UI (AC: 1)
  - [x] 2.1 In `ChatWidget.js`, detect `verified: true` in the `metadata` SSE event or non-stream response
  - [x] 2.2 Display badge "✅ Respuesta verificada por el docente" above the assistant message bubble
  - [x] 2.3 Apply subtle green accent styling (var(--color-success)) to the verified badge
  - [x] 2.4 Verified answer sources appear in the sources footer with materialType icon for "verified-answer"

- [x] Task 3: Pass verified flag through API layer (AC: 1)
  - [x] 3.1 In `api.js` `ragQueryStream`, pass `verified` flag from metadata event to `onEvent`
  - [x] 3.2 In `api.js` `ragQuery`, ensure the non-stream response passes through the `verified` field
  - [x] 3.3 Update mock stream response to optionally include `verified`

## Dev Notes

### What Already Exists (DO NOT REINVENT)

| Existing | Location | Behavior |
|----------|----------|----------|
| RAG query function | `backend/src/functions/rag-query.js` | Full pipeline: embed → filter → query → chat. Both stream and non-stream paths |
| Pinecone query | `backend/src/services/vector-store.js:151` | `querySimilar(embedding, filter, topK)` — returns `[{ id, score, metadata }]` |
| Embedding generation | `backend/src/services/ai.js` | `generateEmbedding(text)` → 1536-dim vector |
| Verified answer format | `corrections/verify-answer/index.js` | Upserts to Pinecone with `materialType: "verified-answer"` metadata |
| Pinecone filter builder | `rag-query.js:183` | `buildPineconeFilter(subjectId, classIds)` — builds compound filter |
| Verified answer score threshold | Epics file §Epic 4 §Story 4.3 | 0.85 similarity threshold |
| ChatWidget streaming | `frontend/src/components/ChatWidget.js` | `api.ragQueryStream()` with `onEvent(type, data)` callback |
| Metadata SSE event | `rag-query.js:450` | `event: metadata` with `{ interactionId, sources }` |
| Source chip rendering | `ChatWidget.js:135-140,306-314` | Deduplicated source chips with material type icons |
| MOCK_RAG_RESPONSES | `api.js` (check this — defined before `ragQuery`) | Mock data for dev mode |
| Design system | `variables.css` | `var(--color-success)` = `#10b981` — use for verified badge |
| Auth & enrollment | `rag-query.js:269-283` | Teacher/director bypass, student must be enrolled |
| Telemetry tracking | `rag-query.js:481-493,566-582` | `trackRAGInteraction()` with userId, subjectId, durationMs, etc. |

### Previous Story Intelligence (4.2 — Verify and Publish Corrected Answer)

- **Verified answer Pinecone metadata shape** (from `verify-answer/index.js` dev notes, lines 113-127):
  ```javascript
  {
    materialType: 'verified-answer',
    subjectId,                  // from correction
    classId: correction.classId,
    originalQuestion,           // the student's question that was reported
    teacherId: userId,          // teacher who verified
    sourceFilename: `correction-${correctionId}`,
    lectureDate: new Date().toISOString(),  // full ISO 8601 datetime
    chunkIndex: 0,
    materialId: `corr-${correctionId}`,
  }
  ```
- `correctionId` uses UUID **without dashes** (RowKey pattern for Table Storage)
- Pinecone upsert uses `upsertChunks` (not raw upsertVectors) — the function is exported from `vector-store.js`
- Critical: 4.2 code review revealed race-condition protection — after upsert, re-read correction from table and verify `teacherId` match before proceeding to Pinecone upsert
- Explanation field added to `toCorrectionEntity` / `fromCorrectionEntity`
- `explanation` max 5000 chars on both frontend and backend

### Git Intelligence

Recent commits relevant to this epic:
- `a91b881` — chore: ignore auto-generated nested host.json files
- `b6d29eb` — fix(deploy): add verify-answer import to functions entry point
- `066db39` — feat(4.2): verify and publish corrected answer
- `6ce5a7f` — fix(deploy): remove auth block from SWA config
- `d3c8ae2` — feat(corrections): implement teacher correction inbox (Story 4.1)

All correction infrastructure (4.1 + 4.2) is in place. Story 4.3 is the final piece of the content quality workflow.

### Key Implementation Details

#### 1. Verified-Answer-First Search in `rag-query.js`

Insert this logic **between** steps 3 (build filter) and 4 (standard search):

```javascript
// ── 3b. Verified-answer-first pre-search ──────────────────
const VERIFIED_SCORE_THRESHOLD = 0.85;
const verifiedFilter = {
  subjectId: { $eq: subjectId },
  materialType: { $eq: 'verified-answer' },
};

let verifiedMatches = [];
let isVerifiedAnswer = false;
let verifiedAnswerText = '';
let verifiedMetadata = null;

try {
  verifiedMatches = await querySimilar(questionEmbedding, verifiedFilter, 5);
  const topVerified = verifiedMatches[0];
  if (topVerified && topVerified.score > VERIFIED_SCORE_THRESHOLD) {
    isVerifiedAnswer = true;
    verifiedAnswerText = topVerified.metadata?.text || topVerified.metadata?.correctedAnswer || '';
    verifiedMetadata = topVerified.metadata;
    context.log(`[RAG] Verified answer match (score=${topVerified.score.toFixed(3)}) — bypassing LLM`);
  }
} catch (err) {
  context.error('[RAG] Error in verified-answer pre-search (non-blocking):', err);
  // Fall through to standard search — do NOT block the query
}
```

**In the stream path:** When `isVerifiedAnswer === true`, skip the LLM and send the verified answer directly:
```javascript
if (isVerifiedAnswer && verifiedAnswerText) {
  // Skip to building sources from the verified match
  const verifiedSources = [{
    materialType: 'verified-answer',
    materialPriority: 'primary',  // verified answers are always primary
    classId: verifiedMetadata?.classId,
    chunkIndex: 0,
    sourceFilename: verifiedMetadata?.sourceFilename || `correction-${correctionId}`,
    score: Math.round(topVerified.score * 100) / 100,
  }];
  // Stream or return directly
}
```

**In the non-stream path:** Same logic but return the answer in JSON.

**Important:** Do NOT call the LLM when returning a verified answer — save cost. The verified answer text (`verifiedMetadata.text`) is the teacher's `correctedAnswer` already in natural language.

#### 2. Response Contract Changes

Add to the JSON response:
```javascript
{
  id: interactionId,
  answer: "...",
  sources: [...],
  verified: true,          // NEW: true when answer is teacher-verified
  verifiedBy: "teacherId", // NEW: optional, who verified it
}
```

For the SSE stream, add to the `metadata` event:
```javascript
event: metadata
data: {
  "interactionId": "...",
  "sources": [...],
  "verified": true,
  "verifiedBy": "teacherId"
}
```

#### 3. Frontend ChatWidget Changes

In the `metadata` event handler (`ChatWidget.js:302`), store the `verified` flag:
```javascript
if (type === 'metadata') {
  assistantMsg.sources = data.sources || [];
  assistantMsg.verified = data.verified || false;
  // ... existing source rendering ...
  // Add verified badge
  if (data.verified) {
    const msgEl = getMsgEl();
    if (msgEl) {
      const badgeEl = document.createElement('div');
      badgeEl.className = 'verified-badge';
      badgeEl.style.cssText = 'display:flex;align-items:center;gap:4px;padding:4px 10px;margin-bottom:8px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.2);border-radius:var(--radius-md);color:var(--color-success);font-size:12px;font-weight:600;';
      badgeEl.innerHTML = '✅ Respuesta verificada por el docente';
      msgEl.querySelector('.chat-msg-body')?.prepend(badgeEl);
    }
  }
}
```

For non-stream rendering, add the verified badge in `renderMessage()`:
```javascript
${msg.verified ? `
  <div class="verified-badge" style="display:flex;align-items:center;gap:4px;padding:4px 10px;margin-bottom:8px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.2);border-radius:var(--radius-md);color:var(--color-success);font-size:12px;font-weight:600;">
    ✅ Respuesta verificada por el docente
  </div>
` : ''}
```

#### 4. Source Display for Verified Answers

Add a material type icon/name mapping for "verified-answer":
```javascript
const materialIcon = (type) => {
  const map = {
    transcript: 'document',
    presentation: 'presentation',
    notes: 'notes',
    bibliography: 'book',
    'verified-answer': 'verified',  // NEW
  };
  return icon(map[type] || 'document');
};
```

Add a verified icon to the icon map:
```javascript
verified: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
```

### Architecture Compliance

- **No new Functions:** This is a modification to the existing `rag-query` function exclusively
- **Pattern:** Follow existing dual-search pattern already used for bibliography fallback (`buildPineconeFilter` with `$or` clause)
- **API response format:** Must follow `{ success, data, error, meta }` — but note that `rag-query` currently uses a custom format `{ id, answer, sources, error }`. Do NOT refactor the response shape — add `verified` field to the existing format
- **No new Pinecone index/namespace:** Verified answers live in the same index, filtered by `materialType` metadata field
- **File naming:** No new files needed — only modifications to existing files
- **Tests co-located:** Add tests to `backend/src/functions/rag-query.test.js`
- **context.log()** for all logging, never `console.log()`
- **Dates:** ISO 8601 UTC with `Z`

### File List (applied)

- `backend/src/functions/rag-query.js` (**MODIFIED** — added verified-answer-first pre-search in stream and non-stream paths)
- `backend/src/functions/rag-query.test.js` (**MODIFIED** — added 4 test scenarios for verified answer path)
- `frontend/src/components/ChatWidget.js` (**MODIFIED** — verified badge in metadata handler and renderMessage, materialIcon for verified-answer)
- `frontend/src/services/api.js` (**MODIFIED** — `verified` flag pass-through in ragQueryStream and ragQuery mock)

### Change Log

- 2026-06-18: All tasks completed. Verified answer pre-search, chat UI badge, API pass-through implemented and tested.

### Error Handling

| Scenario | Behavior |
|----------|----------|
| Pinecone fails on verified search | Log error, fall through to standard search (non-blocking) |
| Verified answer text is empty | Skip verified path, fall through to standard search |
| Verified answer score < 0.85 | Fall through to standard search (normal behavior) |
| No verified answers in Pinecone | `verifiedMatches` empty, fall through to standard search |

### Security

- Verified-answer-only filter includes `subjectId` — same data segregation guarantee as standard search
- No additional auth checks needed — the existing enrollment check already runs before this step
- Teacher ID stored in metadata for audit trail but NOT exposed to students

### Testing Strategy

In `rag-query.test.js`, add:
1. **Test:** When Pinecone returns verified answer with score > 0.85, respond directly without LLM call
2. **Test:** When Pinecone returns verified answer with score < 0.85, fall through to standard search
3. **Test:** When Pinecone returns no verified answers, proceed to standard search
4. **Test:** When Pinecone verified search fails (error), gracefully fall through to standard search
5. **Test:** Response JSON includes `verified: true` when verified answer is used
6. **Test:** Response JSON includes `verified: false` (or absent) when standard search is used
7. **Test:** Verified answer source metadata is correct in response sources

### Notification Strategy (Do NOT over-engineer)

- **DO NOT** implement any notification in this story
- **DO NOT** implement any Graph API integration
- This story is purely a RAG pipeline modification — the verified answer is already in Pinecone from Story 4.2

### Future Stories (DO NOT IMPLEMENT NOW)

- Verified answer freshness/expiration (e.g., mark outdated verified answers)
- Track verified answer usage analytics separately
- Teacher analytics on how often verified answers are served

### Project Context Reference

- See `project-context.md` §§3-5 for data models, API contracts, and implementation rules
- Pinecone metadata interface: `PineconeMetadata` — `materialType: "verified-answer"` is a valid type
- Chunking: Verified answers are single-chunk (chunkIndex: 0), no splitting needed
- `context.log()` for all logging, never `console.log()`
- Dates: ISO 8601 UTC with explicit `Z`
- CSS: All colors via CSS variables, Montserrat typography, 4px grid, dark-first design

## Dev Agent Record

### Agent Model Used

opencode/deepseek-v4-flash-free

### Debug Log References

### Completion Notes List

- All 3 tasks completed: verified-answer-first pre-search in RAG pipeline, verified badge in ChatWidget, API pass-through
- 4 test scenarios verified passing (score > 0.85, score < 0.85, no matches, error fallback)
- Backend changes in rag-query.js (lines 320-376), frontend changes in ChatWidget.js and api.js

### File List
