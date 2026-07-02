# Epic 3 Context: Conversational RAG Experience

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Students ask natural-language questions about their class materials and receive contextual, cited answers based exclusively on indexed content. Every response includes verifiable source citations, falls back gracefully when material coverage is insufficient, and is logged for audit. Students can rate answers, save conversation threads, and report incorrect responses — creating feedback loops that improve answer quality over time.

## Stories

- Story 3.1: Core RAG Chat with Filtering
- Story 3.2a: Response Rating
- Story 3.2b: Save Conversation Threads
- Story 3.3: Report Incorrect Response
- Story 3.5: Source Transparency in RAG Responses
- Story 3.6: Student Onboarding

## Requirements & Constraints

- End-to-end chat response must complete in < 3 seconds (P95): embedding → Pinecone search → LLM generation → response delivery to frontend.
- Every Pinecone query must filter by `subjectId` + selected `classIds` to prevent cross-subject data leakage.
- Every response must include clickable source citations showing material type, class, chunk index, and filename.
- When retrieved chunk relevance averages < 0.6, return a "no information found" fallback — never hallucinate.
- Rate limit students to 50 queries/hour (enforced server-side).
- Every query must be logged with `userId`, `timestamp`, `subjectId`, and `sources` for audit.
- Terms of use consent (Epic 1) must be confirmed before allowing any chat interaction.
- Primary LLM: DeepSeek V4 Flash via Azure AI Foundry. Fallback: GPT-4o mini via Azure OpenAI.
- Embedding model: `text-embedding-3-small` (dimension 1536).
- Chat interface must meet WCAG 2.1 AA (keyboard navigation, ARIA labels, color contrast).
- Students must only see subjects they are enrolled in (enrollment validated by Epic 1).

## Technical Decisions

- RAG pipeline: question embedding → Pinecone similarity search with metadata filter → augment system prompt with retrieved chunks → LLM response with source annotations.
- Pinecone retrieval: top-10 chunks, cosine similarity, relevance floor of 0.6.
- Chunk size: 512 tokens / 50 overlap (produced by Epic 2 pipeline, consumed by RAG).
- Conversations stored in Azure Table Storage (`Conversations` table: PartitionKey `userId`, RowKey `timestampInverted+conversationId`, JSON messages column). ConversationRatings table for feedback (PartitionKey `conversationId`, RowKey `messageIndex`).
- Rate limiting uses Table Storage counters per user per endpoint per hour, checked via middleware before query execution.
- Custom App Insights event `RagQuery.Executed` emitted per query with latency breakdown (embedding, vector search, LLM first-token, total) and `costUsd`.
- No streaming (SSE/WebSocket) — request/response HTTP only. Loading state managed client-side.
- DeepSeek accessed via Azure AI Foundry endpoint; if unavailable or over budget, switch to GPT-4o mini via the existing `RS-OPENAI-LLM` deployment.
- Frontend formulates the RAG question to the backend function; the function handles all AI and vector DB calls.

## UX & Interaction Patterns

- Chat screen: 2-column layout on desktop (class selector + material filter sidebar | message area), single column on mobile with collapsible sidebar.
- User messages: right-aligned, `--surface-3` background. AI responses: left-aligned, `--surface-1` background, with source citation chips below.
- Source citations: clickable chips showing material type icon + filename + chunk index. Clicking opens a modal with the original chunk text and a download link to the full material.
- Suggested questions: ghost pill buttons in the sidebar, pre-generated from available material topics.
- Rating: thumbs-up / thumbs-down buttons below each AI response. Thumbs-down opens optional free-text field: "¿Qué esperabas?"
- Report incorrect: "Reportar respuesta incorrecta" button opens a modal with read-only question/response + required textarea (min 10 chars) + submit button.
- Save conversation: "Guardar conversación" button stores the full thread. Accessible from "Mis Conversaciones Guardadas" list showing date, subject, first question preview, message count.
- Student onboarding: 4-step overlay on first chat access (select classes, write question, check sources, report issues). Dismissed via localStorage flag.
- Loading state: skeleton cards for AI response + animated typing indicator. Error state: inline retry button with error-colored border.

## Cross-Story Dependencies

- Stories 3.1–3.6 depend on Epic 2: materials must be ingested, chunked, embedded, and stored in Pinecone before the RAG system can retrieve them.
- Story 3.3 feeds into Epic 4 (Content QA Workflow): student reports create `Corrections` records that teachers review and verify.
- Story 3.2a rating data feeds into Epic 6 (Director Analytics) for cost-per-query and satisfaction metrics.
- Story 3.2b depends on the `Conversations` Table Storage table provisioned by Epic 9 (Infrastructure).
- Story 3.5 depends on Pinecone chunk metadata (`materialType`, `classId`, `chunkIndex`, `sourceFilename`, `lectureDate`) being correctly populated by the Epic 2 ingest pipeline.
- Story 3.6 onboarding state is client-side only (localStorage), no backend dependency.
