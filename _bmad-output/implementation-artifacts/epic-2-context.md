# Epic 2 Context: Enhanced Material Ingestion & Transcription Correction

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Teachers upload multi-format class materials (VTT, DOCX, PDF, PPTX, TXT) that are automatically processed through a serverless pipeline — extracted, chunked, embedded, and indexed into Pinecone. After ingestion, teachers can review AI-suggested transcription corrections against a subject-specific technical glossary, accept or edit fixes, and trigger re-embedding. Materials can be prioritized to influence RAG retrieval order. Clear error messages guide recovery when processing fails. The epic also includes teacher onboarding for first-time use of upload and correction features.

## Stories

- Story 2.1: Bulk Material Upload
- Story 2.2: Material Processing Pipeline
- Story 2.3: Transcription Correction with Glossary
- Story 2.4: Material Priority Override
- Story 2.5: Actionable Error Handling
- Story 2.6: Teacher Onboarding

## Requirements & Constraints

- **Upload & association (FR6-8):** Teachers upload files (TXT, DOCX, PDF, PPTX, VTT), select material type (transcript/presentation/notes/bibliography), and associate with a class. Up to 5 files simultaneously via drag-and-drop.
- **Pipeline states (FR13, FR15):** Each material flows pending → processing → ready/error. Raw file stored in Blob Storage (`class-materials/{classId}/{materialId}`).
- **Text extraction & chunking (FR9-10):** Parse per MIME type; split into 512-token chunks with 50-token overlap using `js-tiktoken`.
- **Embedding & persistence (FR11-12):** Generate embeddings via `text-embedding-3-small` (1536 dimensions). Upsert to Pinecone Serverless (cosine similarity) with metadata: `subjectId`, `classId`, `materialId`, `materialType`, `chunkIndex`, `sourceFilename`, `lectureDate`.
- **Transcription correction (FR16-20):** System detects transcription errors using subject glossary (Blob JSON). Teacher reviews side-by-side, accepts AI suggestions or edits manually. Approved corrections trigger re-embedding.
- **Priority (FR indirectly):** Materials can be assigned priority 1-5 (default 3). Higher-priority materials ranked first in RAG retrieval via reranking.
- **Error handling (FR13, Journey 5):** Specific user-facing error messages for scanned PDFs, corrupt files, files > 50MB. "Reintentar" re-queues for processing.
- **Notification (FR14):** Teachers notified via Teams when processing completes (success or error).
- **NFR constraints:** Ingest < 5s for files < 10MB; pipeline handles 10 simultaneous files; errors isolated per file; retry with exponential backoff for OpenAI/Pinecone calls; rate limit of 10 uploads/hour per teacher.

## Technical Decisions

- **Glossary storage:** JSON file per subject in Blob (`glossary/{subjectId}.json`), loaded into memory at Function startup (~100KB/subject). Editable through teacher UI.
- **Parser architecture:** Strategy pattern in `backend/services/parsers/` — one module per format, registered via factory. Current parsers: VTT, PDF (`pdf-parse`), DOCX (`mammoth`), PPTX (`pptx-parser`), TXT.
- **Pipeline flow:** HTTP trigger `POST /api/ingest-material` → upload to Blob → parse → chunk → embed → Pinecone upsert → update material status. Returns `202 Accepted` with `materialId`.
- **Material data model:** `Material` interface per AGENTS.md §10 — typed per class, with status enum and `blobUrl`. Status updates persisted in Table Storage.
- **Pinecone metadata model:** `PineconeMetadata` per AGENTS.md §10 — includes `subjectId`, `classId`, `materialId`, `materialType`, `chunkIndex`, `sourceFilename`, `lectureDate`.
- **Re-embedding on correction:** After teacher approves/edits corrections, the corrected transcript chunk(s) re-enter the embedding pipeline and are upserted to Pinecone (replacing original chunks).
- **Priority mechanism:** `priority` field on `Material` (1-5 scale). RAG query applies reranking step after Pinecone similarity search to boost higher-priority material chunks.
- **File size limit:** 50MB per file. Enforced at upload and in pipeline.
- **API conventions:** Per architecture patterns — camelCase JSON, ISO 8601 UTC dates, UUID v4 IDs, `{ success, data/error, meta }` response format. Errors logged with `materialId` and `classId`.

## UX & Interaction Patterns

- **Upload screen:** Centered single-column layout. Class selector dropdown, 4 material-type tabs, dashed upload zone with drag-and-drop. States: idle → drag-over (glow) → uploading (progress bar) → success (green check) / error (red + message + retry). Material list table below with status badges (Pending=warning, Processing=info, Ready=success, Error=error).
- **Transcription correction panel:** Side-by-side view: original transcript text | AI-suggested corrections (highlighted). Per-suggestion actions: "Aceptar" or "Editar" (opens inline textarea). Panel accessible from teacher dashboard "Correcciones Pendientes" navigation.
- **Material status badges:** Same color scheme across upload list, class timeline, and correction panel. Error badges clickable to show user-friendly message and retry button.
- **Onboarding overlay:** Step-by-step tour on first teacher login pointing to upload, correction, and priority features. Dismissed via "Entendido" button, completion stored in `localStorage`.
- **Design system:** Dark-first glassmorphism (Montserrat, 4px grid). Cards use `--surface-1` background, upload zone uses `--surface-2` with dashed border. Status colors: success `#10b981`, warning `#f59e0b`, error `#ef4444`, info `#38bdf8`.

## Cross-Story Dependencies

- **Epic 9 (Infrastructure) must precede or parallel 2.2:** Blob containers (`class-materials`, `glossary-files`), Table Storage for material status, and Storage Queue for async notification processing must be provisioned via Bicep before pipeline runs.
- **Epic 1 (Auth) must precede 2.1:** Teacher identity, role validation, and subject-scoped access control required before upload forms are functional.
- **Story 2.3 depends on 2.2:** Transcription correction requires the processing pipeline to exist (parsing, chunking, storage) before corrections can be applied and re-embedded.
- **Story 2.4 depends on 2.2 + Epic 3:** Priority metadata is written during ingestion (2.2) but consumed during RAG retrieval (Epic 3). Priority field must be included in Pinecone metadata from the start.
- **Story 2.5 depends on 2.2:** Error handling is a UX layer over the pipeline's error states.
- **Story 2.6 (onboarding) is independent** of other stories — pure frontend with `localStorage` flag.
- **Story 2.2 Teams notification (FR14)** depends on Epic 9 Key Vault secrets (Graph API credentials) and the notification Function from Epic 5.
