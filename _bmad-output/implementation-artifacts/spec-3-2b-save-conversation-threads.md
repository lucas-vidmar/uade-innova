---
title: 'Story 3.2b — Save Conversation Threads'
type: 'feature'
created: '2026-06-18'
baseline_commit: '6527c4deb26616a560f5057a576fe5147e0cccfc'
status: 'done'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Students have no way to persistently save chat conversations for later review. The only persistence is per-interaction Blob logs, which are not queryable or organized as conversation threads.

**Approach:** Add a "Guardar conversación" button in the chat widget that saves the full message thread to the existing `Conversations` Table Storage table as a single JSON entity. Add a "Mis Conversaciones Guardadas" panel to browse, reopen, and delete saved threads.

## Boundaries & Constraints

**Always:**
- Storage uses existing `Conversations` table (PartitionKey=`userId`, RowKey=`timestampInverted+conversationId`) — already provisioned in Bicep
- Messages stored as a JSON array in a single `messages` column — not a separate messages table
- Every entity must include: `subjectId`, `messages`, `createdAt`, `lastMessageAt`, `messageCount`, `firstQuestion` (preview string)
- The save button must be visible only when there are 1+ messages in the thread
- Reopening a saved conversation restores the full message array into the chat widget and sets the sessionId to the saved conversation's ID
- Delete must remove the entity from Table Storage
- All endpoints require Front Door ID validation, auth, and enrollment check (same pattern as existing chat endpoints)
- Mock mode must be implemented for all new API methods

**Ask First:** None expected.

**Never:**
- Do NOT create a new storage table — `Conversations` is already provisioned
- Do NOT modify the existing `chat-logs` Blob Storage persistence or `rag-query.js`
- Do NOT modify the existing feedback/rating/report endpoint behavior
- Do NOT add streaming or real-time sync for saved conversations

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Save conversation | `{ conversationId, subjectId, messages }` with 3+ messages | Upsert to `Conversations` table; `{ success: true, conversationId }` | Return 400 if messages empty or missing subjectId |
| List conversations | `GET ?subjectId=X` | Returns array sorted by `lastMessageAt` desc with `{ conversationId, subjectId, firstQuestion, messageCount, lastMessageAt }` | Return empty array `[]` if none |
| Get single conversation | `GET /{id}?subjectId=X` | Returns full entity with `messages` array | Return 404 if not found or belongs to different user |
| Delete conversation | `DELETE /{id}?subjectId=X` | Deletes entity, returns `{ success: true }` | Return 404 if not found |
| Save empty thread | 0 messages | 400 Bad Request | `{ error: "No hay mensajes para guardar" }` |
| Reopen conversation | Click load on a saved item | Messages restored into chat widget, `currentSessionId` set to saved `conversationId` | N/A |
| Unauthenticated | Missing or invalid auth headers | 403 Forbidden | Front Door + auth middleware |
| Not enrolled student | Valid auth, no enrollment for subjectId | 403 Forbidden | Same pattern as `chat-feedback` |
| Duplicate save (same conversationId) | Existing conversation ID + new messages | Upsert merges — overwrites messages, updates `lastMessageAt` | N/A |

</frozen-after-approval>

## Code Map

- `backend/src/services/state-store.js` — Add `CONVERSATIONS_TABLE` constant, `saveConversation()`, `getConversation()`, `listConversationsByUser()`, `deleteConversation()`
- `backend/src/functions/conversations-api.js` — New file with 4 HTTP handlers: PUT save, GET list, GET by id, DELETE
- `backend/src/functions/chat-api.js` — No changes (separate file for conversations API)
- `backend/src/index.js` — Import and register `conversations-api.js`
- `frontend/src/services/api.js` — Add `saveConversation()`, `listConversations()`, `getConversation()`, `deleteConversation()`
- `frontend/src/components/ChatWidget.js` — Add "Guardar conversación" button after last assistant message; add "Mis Conversaciones Guardadas" panel
- `frontend/src/components/SavedConversationsModal.js` — New component for browsing saved conversations

## Tasks & Acceptance

**Execution:**
- [x] `backend/src/services/state-store.js` — Add `CONVERSATIONS_TABLE` constant, `toConversationEntity()`, `saveConversation()`, `getConversation()`, `listConversationsByUser()`, `deleteConversation()`. Follow exact pattern of `Corrections` functions (mapper functions, upsertEntity, queryByPartition, deleteEntity)
- [x] `backend/src/functions/conversations-api.js` — New file with 4 handlers: `PUT /api/conversations/{id}`, `GET /api/conversations` (list), `GET /api/conversations/{id}`, `DELETE /api/conversations/{id}`. Follow exact middleware pattern from `chat-api.js` (validateFrontDoorId, getAuthenticatedUser, enrollment check, JSON response format)
- [x] `backend/src/index.js` — Add `import './functions/conversations-api.js'`
- [x] `frontend/src/services/api.js` — Add 4 methods: `saveConversation({ conversationId, subjectId, messages })`, `listConversations(subjectId)`, `getConversation(conversationId, subjectId)`, `deleteConversation(conversationId, subjectId)`. Include mock implementations for each
- [x] `frontend/src/components/ChatWidget.js` — Add "Guardar conversación" button in the chat header (next to "Nuevo chat"), visible when `messages.length > 0`. On click: call `api.saveConversation()` with current messages and show success toast. Add "Mis Conversaciones Guardadas" button that opens the SavedConversationsModal
- [x] `frontend/src/components/SavedConversationsModal.js` — New component showing list of saved conversations (fetch via `api.listConversations()`). Each item shows: date, subject, first question preview, message count. Actions: "Cargar" (loads messages into chat widget and closes modal), "Eliminar" (calls `api.deleteConversation()` then refreshes list). Empty state when no saved conversations

**Acceptance Criteria:**
- Given a student has an active chat with 1+ messages, when they click "Guardar conversación", then the thread is stored in the `Conversations` table and a success toast is shown
- Given a student has saved conversations, when they open "Mis Conversaciones Guardadas", then they see a list with date, subject, first question preview, and message count
- Given a student clicks "Cargar" on a saved conversation, when the modal closes, then the full message thread is restored in the chat widget
- Given a student clicks "Eliminar" on a saved conversation, when confirmed, then the entity is removed from the `Conversations` table and the list refreshes

## Verification

**Commands:**
- `npm run lint --prefix backend` — expected: no errors
- `npm run lint --prefix frontend` — expected: no errors

**Manual checks:**
- Start local Functions (`func start`) and send PUT to `/api/conversations/{id}` with valid body — verify `{ success: true }` response
- GET `/api/conversations?subjectId=X` — verify saved conversations list returned
- Open chat UI, send messages, click "Guardar conversación", verify success toast
- Click "Mis Conversaciones Guardadas", verify saved conversations appear
- Click "Cargar" on a saved conversation, verify messages restored in chat widget

## Suggested Review Order

**Data Layer — Table Storage CRUD**

- RowKey encodes inverted timestamp for newest-first sort
  [`state-store.js:12`](../../backend/src/services/state-store.js#L12)
- Entry point for persisting a conversation thread
  [`state-store.js:530`](../../backend/src/services/state-store.js#L530)
- Lookup by conversationId via partition scan
  [`state-store.js:542`](../../backend/src/services/state-store.js#L542)
- User-scoped listing with optional subjectId filter
  [`state-store.js:566`](../../backend/src/services/state-store.js#L566)
- Entity deletion by conversationId
  [`state-store.js:588`](../../backend/src/services/state-store.js#L588)

**Backend API — HTTP Endpoints**

- PUT save with FrontDoor + auth + enrollment middleware, preserves `createdAt` on re-save
  [`conversations-api.js:5`](../../backend/src/functions/conversations-api.js#L5)
- GET list returns conversation summaries (no message bodies)
  [`conversations-api.js:64`](../../backend/src/functions/conversations-api.js#L64)
- GET by id returns full thread with all messages
  [`conversations-api.js:116`](../../backend/src/functions/conversations-api.js#L116)
- DELETE removes entity, returns 404 if not found
  [`conversations-api.js:164`](../../backend/src/functions/conversations-api.js#L164)
- Module registration in the Azure Functions runtime
  [`index.js:12`](../../backend/src/index.js#L12)

**Frontend Client — API Service**

- Save conversation with minimal payload (`conversationId`, `subjectId`, `messages`)
  [`api.js:1504`](../../frontend/src/services/api.js#L1504)
- List summaries returns `[]` in mock mode
  [`api.js:1522`](../../frontend/src/services/api.js#L1522)
- Get full conversation returns `null` in mock mode
  [`api.js:1535`](../../frontend/src/services/api.js#L1535)
- Delete conversation with async confirmation
  [`api.js:1547`](../../frontend/src/services/api.js#L1547)

**UI — Chat Widget Integration**

- "Guardar" / "Guardadas" buttons in the sources bar, visibility toggles with `messages.length`
  [`ChatWidget.js:57`](../../frontend/src/components/ChatWidget.js#L57)
- Save handler: serializes messages, calls API, shows toast
  [`ChatWidget.js:266`](../../frontend/src/components/ChatWidget.js#L266)
- Guardadas handler: lazy-loads modal, renders conversation list, loads on click
  [`ChatWidget.js:283`](../../frontend/src/components/ChatWidget.js#L283)

**UI — Saved Conversations Modal**

- Modal overlay with close-on-backdrop, loading spinner, empty state
  [`SavedConversationsModal.js:1`](../../frontend/src/components/SavedConversationsModal.js#L1)
- Conversation list rendering with preview, message count, and date
  [`SavedConversationsModal.js:60`](../../frontend/src/components/SavedConversationsModal.js#L60)
- "Cargar" fetches full thread and passes to parent via `onLoad` callback
  [`SavedConversationsModal.js:90`](../../frontend/src/components/SavedConversationsModal.js#L90)
