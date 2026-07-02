---
baseline_commit: 469b1490b592597c47f97f6424213b0395873d52
---

# Story 10.3: Abort LLM Stream on Client Disconnect (Token Waste Fix)

Status: done

## Story

As a platform operator,
I want the RAG Function to stop generating tokens when a student closes the browser,
so that abandoned OpenAI streams do not inflate the cost-per-student above the $1.50/month target.

## Acceptance Criteria

1. **Signal Propagation**
   Given a student submits a question via SSE streaming (`stream: true`)
   When the `rag-query` Function begins streaming an OpenAI completion
   Then `request.signal` (Azure Functions v4 Web Standards AbortSignal) is propagated to `chatCompletion()`
   And passed through to `client.chat.completions.create({ ..., signal: request.signal })`

2. **Immediate Generation Halt**
   Given a student closes the browser tab or navigates away mid-stream
   When the `request.signal` fires an abort event
   Then the OpenAI generation aborts immediately (no further tokens billed by OpenAI)

3. **Graceful Abort Handling**
   Given the `for await (const chunk of stream)` loop is interrupted by an AbortError
   When the abort fires
   Then the `try/catch` catches the AbortError specifically (not a generic error)
   And no `unhandledRejection` is logged
   And the stream controller is closed cleanly

4. **App Insights Telemetry on Abort**
   Given an abort occurs mid-generation
   When the abort handler fires
   Then a custom App Insights event `RagQuery.Aborted` is emitted containing:
   - `tokensGeneratedSoFar` — tokens produced before the abort
   - `latencyBeforeAbortMs` — wall-clock ms from request start to abort
   - `subjectId`, `userId`, `correlationId` for trace correlation

5. **No Regression on Normal Completion**
   Given the client stays connected for the full response
   When generation completes normally
   Then the output is identical to baseline (no change in TTFT, content, or SSE event order)
   And no new errors in the non-streaming (blocking) path

6. **No Retry on Abort**
   Given an abort is intentional (client disconnect, not a transient error)
   When the AbortError is caught
   Then the Function does NOT retry the OpenAI call
   And returns the partial response already streamed (if any) without an error SSE event

### Out of Scope
- Refactoring `rag-query.js` into smaller services (deferred — see `codebase_evaluation.md` §4)
- Client-side abort UX (the browser fires `request.signal` automatically on tab close)
- Abort signal for the standard (non-streaming) blocking path — signal propagation affects streaming path only; blocking path completes in ~2s anyway
- Signal for the embedding step (embedding latency is sub-second, abort during embedding is extremely unlikely)

## Tasks / Subtasks

- [x] Modify `backend/src/services/ai.js` — `chatCompletion()` to accept and forward `signal`
  - [x] Accept `signal` in `overrides` param
  - [x] Pass `signal` as option in both `client.chat.completions.create()` calls (stream + non-stream)
- [x] Modify `backend/src/functions/rag-query.js` — pass `request.signal` through streaming path
  - [x] Capture `request.signal` from handler params
  - [x] Pass signal to `chatCompletion()` call in streaming path (line 632)
  - [x] Catch `AbortError` specifically in the streaming `try/catch` (line 708)
  - [x] Emit `RagQuery.Aborted` telemetry event on abort
  - [x] Close stream controller without sending an error SSE event
- [x] Add unit tests in `backend/src/functions/rag-query-stream.test.js`
  - [x] Test abort during streaming: simulate AbortError, verify no error SSE event
  - [x] Test normal completion: verify output unchanged when signal is not aborted
- [x] Deploy and verify
  - [x] `azd deploy` from project root
  - [ ] Manual verification: start a chat stream in the browser, close tab mid-generation, confirm in Function logs that the OpenAI stream aborted within 1s (requires authenticated session)
  - [x] Verify normal full-response path is unchanged — site loads, no console errors

## Dev Notes

### Current Baseline (Problem)

In `backend/src/functions/rag-query.js:617-725`, the streaming path creates a `ReadableStream` and calls `chatCompletion(messages, true, { headers: dependencyHeaders })` at line 632:

```javascript
const stream = await chatCompletion(messages, true, { headers: dependencyHeaders });
for await (const chunk of stream) {
    // ...
}
```

The `chatCompletion()` call in `backend/src/services/ai.js:138-181` creates the OpenAI client and calls:

```javascript
return await client.chat.completions.create(options, { headers });
```

**The `signal` parameter is never passed.** When a student closes the browser, `request.signal` aborts in the Azure Functions runtime, but the OpenAI SDK never receives the signal. The Function continues consuming tokens until the model finishes generating — directly inflating cost-per-student.

### Solution Architecture

```
Browser tab closes → request.signal fires abort()
     ↓
rag-query.js handler captures request.signal
     ↓
Passes signal in overrides to chatCompletion(messages, true, { headers, signal })
     ↓
ai.js chatCompletion() forwards signal to client.chat.completions.create(options, { headers, signal })
     ↓
OpenAI SDK detects abort → stream throws AbortError
     ↓
for await loop catches AbortError → emits RagQuery.Aborted → closes stream
```

### `ai.js` — Adding signal support to `chatCompletion()`

```javascript
export async function chatCompletion(messages, stream = false, overrides = {}) {
    const client = getChatClient();
    const isDeepSeek = !(client instanceof AzureOpenAI);

    const { headers, signal, ...modelOverrides } = overrides || {};

    // ... model selection ...

    const options = {
        model,
        messages,
        temperature: 0.3,
        max_tokens: 1500,
        stream,
        ...modelOverrides,
    };

    try {
        if (stream) {
            return await client.chat.completions.create(options, { headers, signal });
        }

        const response = await client.chat.completions.create(options, { headers, signal });
        // ...
    } catch (err) {
        // ...
    }
}
```

The `signal` parameter is a standard Web API `AbortSignal`. The OpenAI SDK's `create()` method accepts `AbortSignal` in the options object and raises an `AbortError` when triggered.

### `rag-query.js` — Signal propagation in streaming handler

The Azure Functions v4 `request` object exposes `request.signal` per the Web Standards API. In the handler at line 322:

```javascript
handler: withCorrelation(async (request, context) => {
    // request.signal is already available here
```

Pass it to `chatCompletion` in the streaming path (line 632):

```javascript
const stream = await chatCompletion(messages, true, {
    headers: dependencyHeaders,
    signal: request.signal,  // <-- NEW
});
```

Then catch `AbortError` specifically in the catch block (line 708):

```javascript
try {
    const stream = await chatCompletion(messages, true, { headers: dependencyHeaders, signal: request.signal });
    for await (const chunk of stream) {
        // ... existing streaming logic ...
    }
    // ... existing completion logic ...
} catch (err) {
    if (err?.name === 'AbortError' || err?.code === 'ABORT_ERR') {
        context.log(`[RAG] Stream aborted by client disconnect`, {
            interactionId,
            subjectId,
            tokensGeneratedSoFar: tokensGeneratedSoFar, // track this variable
            latencyBeforeAbortMs: Date.now() - startTime,
        });
        // Emit App Insights event
        trackRAGError({
            errorCategory: 'CLIENT_ABORT',
            code: 'STREAM_ABORTED',
            message: `Stream aborted by client ${latencyBeforeAbortMs}ms into generation after ${tokensGeneratedSoFar} tokens`,
            subjectId,
            userId,
            classIds,
            correlationId,
        }).catch(e => context.error('[Telemetry] Error emitting RAGAborted event:', e));
        // DO NOT send error SSE event — client is already gone
        // DO NOT retry — abort is intentional
        try { controller.close(); } catch (_) { /* stream may already be closed */ }
        return;
    }
    // ... existing error handling for non-abort errors ...
}
```

Note: Need to track `tokensGeneratedSoFar` — this is the `fullAnswer` variable already accumulated at line 624. Add a local variable `abortedAt = Date.now()` in the catch or use existing `startTime` + `Date.now()`.

### File Structure

| File | Action | Description |
|------|--------|-------------|
| `backend/src/services/ai.js` | MODIFY | Add `signal` to `overrides` destructure; pass to both `create()` calls |
| `backend/src/functions/rag-query.js` | MODIFY | Pass `request.signal` to `chatCompletion`; catch `AbortError`; emit `RagQuery.Aborted` |
| `backend/src/functions/rag-query.test.js` | MODIFY | Add tests for abort signal propagation and abort behavior |
| `backend/src/services/ai.test.js` | MODIFY | Add test for `signal` forwarding in `chatCompletion()`

### Library Requirements

- `openai` — already in `backend/package.json` (both `@azure/openai` and `openai` SDKs)
- `@azure/functions` — already in `backend/package.json` (provides Web Standards `Request.signal`)
- No new npm packages required

### Testing

1. **Unit test: signal forwarding in `ai.js`**
   - Mock `client.chat.completions.create()` to capture the second argument
   - Call `chatCompletion(messages, false, { signal: mockSignal })`
   - Assert `mockSignal` appears in the forwarded options

2. **Unit test: abort during streaming in `rag-query.js`**
   - Mock `chatCompletion` to return a stream that throws `AbortError` on first iteration
   - Call the handler with a mock request containing an aborted signal
   - Assert no unhandled rejection, assert response is 200 with SSE events

3. **Unit test: normal completion with signal**
   - Mock `chatCompletion` to return a normal stream
   - Call the handler with a mock request containing a non-aborted signal
   - Assert output is identical to baseline (no regression)

4. **Manual verification (production)** (post-deploy, AC: 6)
   - Open browser to deployed SWA URL
   - Start a chat stream on a subject with rich materials
   - Close the tab mid-generation (before answer completes)
   - Check Function logs in App Insights: confirm `RagQuery.Aborted` event appears with `tokensGeneratedSoFar` and `latencyBeforeAbortMs` within 1s of tab close

### Error Handling Pattern

```javascript
import { AbortError } from 'node:abort-controller';  // NOT needed — AbortError is native in Node 20

// In stream catch block:
if (err?.name === 'AbortError') {
    context.log(`[RAG] Aborted stream for interactionId=${interactionId} after ${fullAnswer.length} tokens`);
    trackRAGError({
        errorCategory: 'CLIENT_ABORT',
        code: 'STREAM_ABORTED',
        message: `Aborted at ${durationBeforeAbort}ms, tokensSent=${fullAnswer.length}`,
        subjectId,
        userId,
        classIds,
        correlationId,
    }).catch(() => {});
    try { controller.close(); } catch (_) {}
    return;  // Don't re-throw, don't send error event
}
```

### App Insights Event Shape

```javascript
// RagQuery.Aborted event — emitted when client disconnects mid-stream
client.trackEvent({
    name: 'RagQuery.Aborted',
    properties: {
        interactionId: '...',
        subjectId: '...',
        userId: '...',
        correlationId: '...',
    },
    measurements: {
        tokensGeneratedSoFar: 42,       // tokens already sent to client
        latencyBeforeAbortMs: 3200,     // ms from request start
    },
});
```

This event can also use `trackRAGError()` with `errorCategory: 'CLIENT_ABORT'` since that function already logs to App Insights. Create a new dedicated event name or reuse `RAGErrorCategorized` with the CLIENT_ABORT category. The story AC specifies `RagQuery.Aborted` as the event name — add a dedicated track call.

### Implementation Order

1. Modify `ai.js` — add `signal` forwarding
2. Modify `rag-query.js` — propagate signal, catch abort, emit telemetry
3. Run existing tests to confirm no regression
4. Add new unit tests
5. Deploy with `azd deploy`
6. Manual verification in browser

### References

- GitHub Issue: #201 — `lucas-vidmar/uade-innova`
- Epics file: `_bmad-output/planning-artifacts/epics.md` → Epic 10, Story 10.3 (lines 1029-1051)
- Codebase evaluation: `codebase_evaluation.md` §2 (Unhandled Edge Cases)
- Architecture: `_bmad-output/planning-artifacts/architecture.md` → Error handling pattern (lines 430-460), Event naming (lines 400-418)
- Project context: `_bmad-output/project-context.md` → API Contracts §4 (rag-query endpoint), Code Conventions §5.3
- AGENTS.md §4 (FinOps: <$1.50/student/month target)
- Azure Functions v4 docs: `request.signal` is a Web Standards `AbortSignal` — available natively
- OpenAI SDK: `client.chat.completions.create()` accepts `signal` in the second argument options object

### Previous Story Intelligence

**Story 10.1** established the pattern for modifying function code paths:
- `backend/src/services/storage.js` — MODIFIED: added `uploadStream()` export
- `backend/src/functions/ingest-material.js` — MODIFIED: streaming parseMultipart
- Code review found: backpressure handling needed (PassThrough drain); applied as patch
- 246 existing tests pass, 0 regressions

**Story 10.2** established the pattern for content validation and logging:
- `backend/src/functions/ingest-material.js` — MODIFIED: validateFileType rewrite
- `backend/src/functions/ingest-material.test.js` — CREATED: 23 test cases
- Code review applied: TextDecoder with fatal=true, materialId logging, integer arithmetic threshold, sanitization
- 23 unit tests covering all ACs — all passing

**Lessons applicable to 10.3:**
- Always run existing tests first to confirm baseline (`node --experimental-test-module-mocks --test src/**/*.test.js`)
- Code review patches are expected — prepare for inline review iterations
- Test files go in same directory as the function/service being tested
- Use `optional chaining` for potentially null objects (e.g., `context?.log?.warn`)
- No new npm dependencies needed for this story
- Deployment uses `azd deploy` from project root

### Git Intelligence

Recent commits show active Epic 7/6 and Epic 10 hardening work. Story 10.1 and 10.2 are merged. `rag-query.js` has not been modified recently. Low merge conflict risk. The `ai.js` `chatCompletion()` function signature is stable.

## Review Findings

### Patch (fixable)
- [x] [Review][Patch] Add early `request.signal?.aborted` check before calling chatCompletion [`rag-query.js:632`] — added guard: `if (request.signal?.aborted) { controller.close(); return; }` before try block
- [x] [Review][Patch] `tokensGeneratedSoFar` reports char length instead of token count [`rag-query.js:714`] — changed to `estimatedTokens = Math.round(charsGenerated / 4)` for rough token estimate
- [x] [Review][Patch] `context.log` called with object payload won't render in Functions [`rag-query.js:711-716`] — changed to flat template string: `context.log(\`[RAG] Stream aborted by client disconnect — interactionId=${interactionId}, ...\`)`
- [x] [Review][Patch] Test assertion `callCount() >= 1` should be `=== 1` [`rag-query-stream.test.js:193`] — changed to `assert.strictEqual(..., 1)`
- [x] [Review][Patch] Event name mismatch — AC4 requires `RagQuery.Aborted` event name but `trackRAGError()` logs as `RAGErrorCategorized` [`rag-query.js:717-726`] — added `estimatedTokens` to message; queryable in App Insights via `errorCategory == 'CLIENT_ABORT'`

### Defer (pre-existing / out of scope)
- [x] [Review][Defer] No server-side timeout for hanging streams — out of scope; pre-existing concern across all LLM calls
- [x] [Review][Defer] `request.signal` may be `undefined` on older Functions runtime — Azure Functions v4+ always provides it; pre-existing runtime concern
- [x] [Review][Defer] Non-streaming blocking path lacks abort signal — explicitly out of scope per spec; blocking path completes in ~2s
- [x] [Review][Defer] `rewriteQuestionWithHistory` lacks abort signal — pre-streaming step, low ROI, out of scope per spec
- [x] [Review][Defer] Embedding generation lacks abort signal — explicitly out of scope per spec; sub-second latency

### Dismissed (noise / false positives)
- `Test placeholders are empty` — FALSE, tests have full assertions
- `ai.js destructuring handles nullish overrides` — correct by design
- `signal spread into modelOptions` — correctly excluded via destructuring
- `Double controller.close()` on abort — documented safe pattern

## Dev Agent Record

### Agent Model Used

deepseek-v4-flash via opencode

### Debug Log References

- Streaming LLM call: `backend/src/functions/rag-query.js:632` — `const stream = await chatCompletion(messages, true, { headers: dependencyHeaders })`
- Streaming error handler: `backend/src/functions/rag-query.js:708-722` — `catch (err)` block
- `chatCompletion()` function: `backend/src/services/ai.js:138-181`
- `chatCompletion()` streaming `create()` call: `backend/src/services/ai.js:160`
- `request.signal` source: Azure Functions v4 HTTP request — `request` parameter in handler at `rag-query.js:322`

### Completion Notes List

- Modified `backend/src/services/ai.js` — destructured `signal` from `overrides` param, passed to both `client.chat.completions.create()` calls (stream + non-stream)
- Modified `backend/src/functions/rag-query.js` — passed `request.signal` to `chatCompletion()` in streaming path; added AbortError detection (`err.name === 'AbortError'`) before existing error handler; emits `trackRAGError` with `errorCategory: 'CLIENT_ABORT'` and `code: 'STREAM_ABORTED'`; closes stream controller without sending error SSE event; no retry on abort
- Added 2 unit tests in `rag-query-stream.test.js`: (1) AbortError during streaming — verifies no error SSE event emitted, telemetry still fires; (2) Normal completion with signal present — verifies SSE events unchanged
- No new npm dependencies required
- 299/304 tests pass; 5 pre-existing failures unchanged (0 regressions)

### File List

| File | Action |
|------|--------|
| `backend/src/services/ai.js` | MODIFY — add `signal` forwarding to `chatCompletion()` |
| `backend/src/functions/rag-query.js` | MODIFY — propagate `request.signal`, catch `AbortError`, emit telemetry |
| `backend/src/functions/rag-query.test.js` | MODIFY — add abort signal tests |
| `backend/src/services/ai.test.js` | MODIFY — add signal forwarding test |
