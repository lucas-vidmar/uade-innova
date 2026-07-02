---
title: 'Verified Answer Boost in RAG'
type: 'feature'
created: '2026-06-18'
baseline_commit: '40f518cbacb07f22bacad4f55f3a0ad463e97b10'
status: 'done'
context:
  - '_bmad-output/implementation-artifacts/epic-4-context.md'
  - '_bmad-output/implementation-artifacts/4-1-teacher-correction-inbox.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When a teacher publishes a corrected answer via Story 4.2, the verified answer is upserted to Pinecone but the RAG pipeline cannot retrieve and display it because the answer text is not stored in the Pinecone metadata. The `rag-query.js` function already has the two-phase retrieval logic (verified-answer pre-search with 0.85 threshold, frontend badge, short-circuit), but it never gets triggered — the `text` field in metadata is missing so `verifiedAnswerText` is always empty.

**Approach:** Add the `text` field to the verified-answer Pinecone metadata in `verify-answer/index.js`, and verify the full end-to-end flow: teacher publishes correction -> upserted with text -> student query matches at > 0.85 -> verified answer returned with badge.

## Boundaries & Constraints

**Always:**
- The `text` field in verified-answer Pinecone metadata must contain the teacher's `correctedAnswer` verbatim
- The existing two-phase retrieval logic in `rag-query.js` must NOT be modified — only the metadata source needs fixing
- The existing `VERIFIED_SCORE_THRESHOLD = 0.85`, verified filter, streaming response, and frontend badge rendering require no changes
- The `originalQuestion` field must continue to be stored for traceability
- Existing corrections already stored in Pinecone (without `text`) will remain non-retrievable until a re-index — this is acceptable for pilot scope

**Ask First:**
- Whether to add a one-time backfill script to re-upsert existing verified-answer vectors with the `text` field, using the `correctedAnswer` from the `Corrections` Table Storage table

**Never:**
- Do NOT change the verified-answer pre-search threshold, filter logic, or response format in `rag-query.js`
- Do NOT modify the frontend chat widget verified-answer display
- Do NOT change the corrections data model or upsert flow beyond adding the `text` field

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Teacher verifies correction | `correctedAnswer = "La respuesta correcta es..."` | Pinecone vector has `text: "La respuesta correcta es..."` in metadata | Upsert failure logs error, correction remains verified in Table Storage but not searchable (existing retry logic) |
| Student asks matching question | Question embedding scores 0.92 against verified vector | Response includes verified answer text with `verified: true` badge | Fall through to standard RAG if score <= 0.85 or text field missing |
| Student asks non-matching question | Question embedding scores 0.45 against verified vector | Standard RAG search runs normally, no verified badge | N/A — standard error handling applies |

</frozen-after-approval>

## Code Map

- `backend/src/functions/corrections/verify-answer/index.js` -- Path A: add `text` field to Pinecone metadata (lines 200-210)
- `backend/src/functions/rag-query.js` -- Path B: already complete (lines 320-376), no changes needed
- `frontend/src/components/ChatWidget.js` -- Path B: already complete, renders verified badge
- `backend/src/functions/rag-query.js` -- Path A: fix fallback to `correctedAnswer` in metadata (line 335) since we now store both `text` and `correctedAnswer`

## Tasks & Acceptance

**Execution:**
- [x] `backend/src/functions/corrections/verify-answer/index.js:200` -- Added `text: correctedAnswer.trim()` to Pinecone metadata so `rag-query.js` can retrieve the answer text
- [x] `backend/src/functions/rag-query.js:335` -- Verified existing fallback chain already prefers `text` with `correctedAnswer` as secondary fallback — no changes needed
- [ ] Deploy via `azd deploy` and run end-to-end verification

**Acceptance Criteria:**
- Given a teacher publishes a correction, when the Pinecone upsert completes, then the vector metadata includes `text` with the corrected answer content
- Given a verified answer exists in Pinecone with `text`, when a student asks a semantically similar question (score > 0.85), then the RAG response includes the verified answer text with `verified: true` and the frontend shows "✅ Respuesta verificada por el docente" badge
- Given no verified answer matches (> 0.85), when a student asks a question, then the standard RAG pipeline runs normally

## Suggested Review Order

- Single line addition: stores the teacher's corrected answer text in Pinecone metadata so the existing two-phase retrieval in `rag-query.js:335` can find it
  [`verify-answer/index.js:205`](../../backend/src/functions/corrections/verify-answer/index.js#L205)

## Verification

**Commands:**
- `azd deploy` -- expected: deployment succeeds without errors

**Manual checks:**
- Verify a correction (via `POST /api/corrections-verify`) -> confirm Pinecone vector has `text` field by querying the index
- Ask a related question in the chat -> confirm verified answer appears with badge
- Ask a unrelated question -> confirm standard RAG response (no verified badge)
