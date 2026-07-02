---
title: 'Story 3.2a — Response Rating (Thumbs Up/Down)'
type: 'feature'
created: '2026-06-18'
baseline_commit: 'ff823afc673b3fc3134a51befd787d1034e243b0'
status: 'done'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Students can rate RAG responses (thumbs up/down) via the existing `chat-feedback` endpoint, but ratings are only stored in Blob Storage chat logs — they are not queryable for analytics, aggregated reporting, or Epic 6 dashboards. There's also no optional free-text feedback path for negative ratings.

**Approach:** Add a new `POST /api/chat-rate` function that writes ratings to the `ConversationRatings` Table Storage table (already provisioned in Bicep). Update the frontend to call this endpoint alongside the existing feedback flow, and show an optional "¿Qué esperabas?" prompt on thumbs-down.

## Boundaries & Constraints

**Always:**
- Ratings must be stored in `ConversationRatings` table: PartitionKey=`sessionId`, RowKey=`messageId`
- Existing `chat-feedback` endpoint and Blob Storage chat log feedback field must continue working unchanged
- Free-text comment is optional — student can dismiss the prompt without entering text
- Rate-limited to prevent abuse (use existing infrastructure/enforcement)
- Must include `userId`, `subjectId`, `rating`, and `createdAt` in every rating record
- New endpoint must validate enrollment (same as other chat endpoints)
- New endpoint must validate Front Door ID (same pattern as all other functions)

**Ask First:** None expected.

**Never:**
- Do NOT modify or remove the existing `POST /api/chat-feedback` endpoint
- Do NOT add a new storage table — `ConversationRatings` is already provisioned
- Do NOT change the chat log schema or Blob Storage persistence

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Positive rating | `{ sessionId, messageId, subjectId, rating: "positive" }` | Rating saved to `ConversationRatings` table; `{ success: true }` returned | Return 400 if missing required fields |
| Negative rating with comment | `{ sessionId, messageId, subjectId, rating: "negative", comment: "Faltó mencionar el patrón Observer" }` | Rating + comment saved; `{ success: true }` returned | Comment stored as-is; empty string stored if omitted |
| Thumbs-down no comment | `{ sessionId, messageId, subjectId, rating: "negative" }` | Rating saved with empty comment; `{ success: true }` returned | N/A |
| Duplicate rating (same sessionId+messageId) | Rating already exists | Overwrite existing record (upsert) with merge semantics | N/A |
| Unauthenticated request | Missing or invalid auth headers | 403 Forbidden | Front Door + auth middleware |
| Not enrolled student | Valid auth, no enrollment for subjectId | 403 Forbidden with enrollment error message | Same pattern as `chat-feedback` |

</frozen-after-approval>

## Code Map

- `backend/src/functions/chat-api.js` — Add new `POST /api/chat-rate` handler in this file (follows existing pattern of chat-api.js)
- `backend/src/index.js` — No change needed (chat-api.js is already imported)
- `frontend/src/services/api.js` — Add `sendChatRating()` method
- `frontend/src/components/ChatWidget.js` — Update feedback button handler: show optional prompt on negative, call new API
- `backend/src/services/state-store.js` — Add `RATINGS_TABLE` constant, `getTableClient` is already imported

## Tasks & Acceptance

**Execution:**
  - [x] `backend/src/functions/chat-api.js` — Add `POST /api/chat-rate` function that saves rating to `ConversationRatings` table with: `partitionKey: sessionId`, `rowKey: messageId`, `userId`, `subjectId`, `rating`, `comment`, `createdAt`. Use the upsert pattern (`upsertEntity`) to allow re-rating. Reuse existing `validateFrontDoorId`, `getAuthenticatedUser`, and enrollment checks.
- [x] `backend/src/services/state-store.js` — Add `RATINGS_TABLE = process.env.AZURE_TABLE_CONVERSATION_RATINGS || 'ConversationRatings'` constant (reuse existing `getTableClient` and `ensureTable` patterns).
- [x] `frontend/src/services/api.js` — Add `sendChatRating({ sessionId, messageId, subjectId, rating, comment })` method following the same pattern as `sendChatFeedback`.
- [x] `frontend/src/components/ChatWidget.js` — In the feedback button handler (`bindFeedbackEvents`): if `type === 'negative'`, show `showPromptDialog` with title "¿Qué esperabas?" (optional) before submitting. Call `api.sendChatRating()` after `api.sendChatFeedback()`. Update the message object's `feedback` field and add a `rated` field.

**Acceptance Criteria:**
- Given a student receives a chat response and clicks thumbs-up, when the rating is recorded, then a record is created in `ConversationRatings` table with `rating: 'positive'`
- Given a student receives a chat response and clicks thumbs-down, when the rating is recorded, then an optional "¿Qué esperabas?" free-text prompt is shown, and the record includes `rating: 'negative'` with the comment if provided
- Given a student rates the same message twice, when they click the opposite thumbs, then the table record is upserted (not duplicated)
- Given the `ConversationRatings` table is queried by subjectId, when the daily aggregation runs (Story 6.1), then rating counts are available for the director dashboard

## Verification

**Commands:**
- `npm run lint --prefix backend` — expected: no errors
- `npm run lint --prefix frontend` — expected: no errors
- `npm test --prefix backend -- --run src/functions/chat-api.test.js` — expected: existing tests pass (run manually if file exists)

**Manual checks:**
- Start local Functions (`func start`) and send a POST to `/api/chat-rate` with valid body — verify `{ success: true }` response
- Check the `ConversationRatings` table in Storage Emulator (Azurite) for the new record
- Open the chat UI, send a message, click thumbs-up, verify no errors in console
- Click thumbs-down, verify prompt appears, submit empty and with text, verify both paths work

## Suggested Review Order

**New API endpoint**

- New `POST /api/chat-rate` handler with enrollment validation and Table Storage upsert
  [`chat-api.js:195`](../../backend/src/functions/chat-api.js#L195)

- Rating table constant, exported for use across modules
  [`state-store.js:11`](../../backend/src/services/state-store.js#L11)

**Frontend integration**

- API client method for submitting ratings alongside existing feedback
  [`api.js:1455`](../../frontend/src/services/api.js#L1455)

- Feedback handler updated: optional prompt on thumbs-down, dual API call, in-memory state update
  [`ChatWidget.js:399`](../../frontend/src/components/ChatWidget.js#L399)
