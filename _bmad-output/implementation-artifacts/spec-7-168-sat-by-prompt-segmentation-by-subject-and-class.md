---
title: 'SAT-by-prompt segmentation by subject and class'
epic: 7
story: 168
status: done
priority: high
risk: medium
baseline_commit: b4c4a6a7a5eb65530c3343ca9b376ebf83b05426
context:
  - AGENTS.md
deferred_work_file: '_bmad-output/implementation-artifacts/deferred-work.md'
specLoopIteration: 1
---

<frozen-after-approval>

# Spec: SAT-by-prompt segmentation by subject and class

## 1. Why (Job Story)

When I (Director) review SAT analytics, I want to segment user sentiment by subject and (optionally) by class, so that I can compare prompt quality across classes and subjects without manual dashboards.

## 2. Acceptance Criteria

1. **ClassId in Rating**: When a user rates a chat response, the backend stores an optional `classId` alongside the existing `subjectId`, `sessionId`, `messageId`, `rating`, and `comment`.
2. **Partition by Subject**: The `partitionKey` changes from `sessionId` to `subjectId` so that queries by subject are efficient without a full table scan.
3. **SAT-by-Prompt Endpoint**: `GET /api/sat-analytics?subjectId={id}&classId={id}` returns segments grouped by `promptVersion` with `rated`, `positive`, and `satScore` fields.
4. **Director UI Page**: A new page at `/director/sat-analytics` renders the SAT data in a table with subject selector (required), class selector (optional), KPI cards, and per-prompt-version rows.
5. **Authorization**: Only `Docente` and `Director` roles can access the endpoint; students get 403.
6. **Missing ClassId**: Ratings without a `classId` still appear in the subject-level aggregation.
7. **Prompt Version Resolution**: `promptVersion` is resolved from the chat-log blob at rating time rather than requiring the frontend to pass it.

## 3. Boundaries & Constraints

| Rule | Rationale |
|---|---|
| No new Azure resources or Bicep changes | Use existing `ConversationRatings` Table Storage |
| partitionKey changes from sessionId to subjectId | New ratings use subjectId; old data with sessionId is backward-compatible via Merge |
| classId is a single string (first selected class) | Avoids array complexity in Table Storage |
| `promptVersion` resolved server-side from chat log | Keeps frontend changes minimal |
| Only `POST /api/chat-rate` changes (not chat-feedback or chat-report-issue) | Feedback endpoints remain unchanged |
| No new npm packages | Use existing dependencies |
| Vanilla JS, no framework CSS | Follow existing frontend conventions |

## 4. Spec I/O Matrix

| Operation | Input | Output / Side Effect |
|---|---|---|
| POST /api/chat-rate | `{ sessionId, messageId, subjectId, classId?, rating, comment? }` | Upsert in ConversationRatings with partitionKey=subjectId; classId and promptVersion stored |
| GET /api/sat-analytics | `?subjectId=REQUIRED&classId=OPTIONAL` | `{ segments: [{ promptVersion, rated, positive, satScore }], total, filter }` |
| Frontend sendChatRating | `{ sessionId, messageId, subjectId, classId, rating, comment }` | Sends POST to /api/chat-rate with classId |
| Frontend getSatAnalytics | `{ subjectId, classId? }` | Returns parsed response from GET /api/sat-analytics |
| ChatWidget rating | User clicks positive/negative | Extracts selectedClassIds[0] as classId for the API call |

## 5. Processing Notes

- satScore = positive / rated (float 0–1)
- Empty result: `{ segments: [], total: 0, filter: { subjectId, classId } }`
- Error logging must include subjectId/classId for App Insights correlation
- classId === '' means "all classes" (no filter)
- Mock mode for getSatAnalytics returns sample segments for development without backend

## 6. Technical Decisions

1. **partitionKey = subjectId** — Enables OData filter `PartitionKey eq 'subjectId'` instead of scanning all sessions. Backward compatible: old ratings on sessionId key are simply missed by new queries (acceptable for analytics).
2. **classId as optional field** — Stored as regular property; query-side filter by classId done client-side (iterate entities, skip non-matching) to avoid complex composite keys.
3. **promptVersion from chat log** — Resolved at upsert time; avoids version mismatch between what the frontend sends and what the backend knows.
4. **No pagination v1** — MVP: assumes thousands of ratings per subject, not millions. Pagination can be added when needed.
5. **Singular classId** — ChatWidget passes `selectedClassIds[0]`; single string avoids array serialization complexity.

## 7. Code Map

| File | Lines | What changed |
|---|---|---|
| `backend/src/functions/chat-api.js` | 202, 236–250 | Destructure classId from request; dynamic import for loadJson removed; partitionKey switched to subjectId; classId + promptVersion stored; error log updated |
| `backend/src/functions/sat-analytics.js` | 1–70 | New file: GET /api/sat-analytics endpoint with partitionKey filter, classId client-side filter, segmentation by promptVersion |
| `frontend/src/services/api.js` | 1608–1612, 1619–1633 | sendChatRating accepts classId; new getSatAnalytics method with mock |
| `frontend/src/components/ChatWidget.js` | 511 | Extracts selectedClassIds[0] as classId for rating |
| `frontend/src/pages/director/SatAnalytics.js` | 1–201 | New page: filters, KPI cards, segments table, XSS-safe rendering |
| `frontend/src/main.js` | 33 | Route /director/sat-analytics registered |
| `frontend/src/components/Sidebar.js` | 32 | Nav link "SAT por Prompt" added |

</frozen-after-approval>

## Spec Change Log

- **2026-06-20**: Initial spec created from intent + user approval. (specLoopIteration=0)
- **2026-06-20**: Applied review patch fixes: dynamic import removed, bare catch logged, mock filter fixed, error context added, case-insensitive rating, XSS escape, satScore clamp.

## Suggested Review Order

**Backend Analytics Endpoint**

- New SAT-by-prompt aggregation endpoint — design intent and contract
  [`sat-analytics.js:10`](../../backend/src/functions/sat-analytics.js#L10)

- PartitionKey filter scoped to subjectId with OData sanitization
  [`sat-analytics.js:34`](../../backend/src/functions/sat-analytics.js#L34)

- Client-side classId filter with case-insensitive rating match
  [`sat-analytics.js:38`](../../backend/src/functions/sat-analytics.js#L38)

- Segmentation loop groups entities by promptVersion, computes satScore
  [`sat-analytics.js:43`](../../backend/src/functions/sat-analytics.js#L43)

- Error log includes subjectId/classId for App Insights correlation
  [`sat-analytics.js:66`](../../backend/src/functions/sat-analytics.js#L66)

**Backend Schema Change (chat-rate)**

- classId destructured from request body and stored in entity
  [`chat-api.js:202`](../../backend/src/functions/chat-api.js#L202)

- promptVersion resolved from chat-log blob (static import, error logged)
  [`chat-api.js:236`](../../backend/src/functions/chat-api.js#L236)

- partitionKey switched from sessionId to subjectId; classId + promptVersion stored
  [`chat-api.js:244`](../../backend/src/functions/chat-api.js#L244)

**Frontend API Layer**

- sendChatRating forwards classId to backend
  [`api.js:1608`](../../frontend/src/services/api.js#L1608)

- getSatAnalytics with mock fallback for dev
  [`api.js:1619`](../../frontend/src/services/api.js#L1619)

**Frontend UI Binding**

- ChatWidget extracts first selectedClassIds[0] as classId on rating
  [`ChatWidget.js:511`](../../frontend/src/components/ChatWidget.js#L511)

**SAT Analytics Director Page**

- Full page: filter card, KPI bar, segments table, error/loading states
  [`SatAnalytics.js:5`](../../frontend/src/pages/director/SatAnalytics.js#L5)

- XSS-safe rendering with esc() helper and satScore bounds clamping
  [`SatAnalytics.js:84`](../../frontend/src/pages/director/SatAnalytics.js#L84)

- Re-filter handler with dynamic segment table re-render
  [`SatAnalytics.js:109`](../../frontend/src/pages/director/SatAnalytics.js#L109)

**Routing & Navigation**

- Lazy-loaded route for director analytics page
  [`main.js:33`](../../frontend/src/main.js#L33)

- Nav link "SAT por Prompt" in director sidebar
  [`Sidebar.js:32`](../../frontend/src/components/Sidebar.js#L32)
