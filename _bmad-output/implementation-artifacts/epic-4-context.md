# Epic 4 Context: Content Quality Assurance Workflow

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Students can report incorrect or inaccurate chat responses; teachers review them in a dedicated inbox, publish corrections that replace or augment the original answer, and the RAG pipeline surfaces teacher-verified answers ahead of regular material chunks on future semantically similar queries. This closes the feedback loop between AI-generated answers and human subject-matter expertise, building trust in the platform.

## Stories

- Story 4.1: Teacher Correction Inbox
- Story 4.2: Verify and Publish Corrected Answer
- Story 4.3: Verified Answer Boost in RAG

## Requirements & Constraints

- Students report incorrect responses from the chat UI (Epic 3, Story 3.3). Each report captures the original question (read-only), the AI response (read-only), and the student's explanation of what they expected (free text, min 10 chars).
- Teachers see all pending reports for their subjects in a dedicated inbox, filterable by class, with anonymized student identity.
- Teachers write a corrected answer (required) and optionally an additional explanation. On publish, the `Corrections` record transitions to `status="verified"` and the corrected answer is upserted to Pinecone.
- The reporting student receives a Teams notification when their report is resolved.
- Verified answers must be stored in Pinecone with `materialType="verified-answer"` so they can be distinguished from regular material chunks and boosted during retrieval.
- RAG pipeline checks verified answers first with a high similarity threshold (0.85+). If a match is found, it returns the verified answer directly with a visual "Verified by teacher" badge. Otherwise it falls back to standard material search.
- Content moderation and rate limiting apply — students may submit up to 5 reports per hour.
- All correction data uses Azure Table Storage in the existing storage account (no new DB resources needed). No PII in Pinecone metadata.

## Technical Decisions

- **Corrections table** (`Table Storage`): `PartitionKey=subjectId`, `RowKey=correctionId (UUID)`. Columns: `studentId`, `teacherId`, `question`, `originalAnswer`, `correctedAnswer`, `status` (`reported|verified|promoted`), `createdAt`, `resolvedAt`.
- **CorrectionsPending index** (`Table Storage`): `PartitionKey="pending"`, `RowKey=correctionId`. Columns: `subjectId`, `teacherId`, `createdAt`. Denormalized for efficient inbox queries without full table scans.
- **Verified answer Pinecone vectors**: Same 1536-dimension embedding as regular chunks, with metadata: `materialType="verified-answer"`, `subjectId`, `classId`, `originalQuestion`, `teacherId`. No `chunkIndex` or `sourceFilename`.
- **Backend functions** under `backend/src/functions/corrections/`:
  - `POST /api/corrections-report` — create new report (called by student chat)
  - `GET /api/corrections-pending` — list pending reports for teacher inbox (filtered by subjectId, optional classId)
  - `POST /api/corrections-verify` — teacher publishes correction, upserts to Pinecone, sends Teams notification
- **Frontend components**: `ReportResponseWidget` (button + modal in chat), `TeacherCorrectionInbox` (pending list + verify form).
- **RAG verified-answer boost**: Two-phase retrieval. Phase 1 queries Pinecone for `materialType="verified-answer"` with the student's question embedding. If best score > 0.85, return verified answer directly with badge. Phase 2 falls back to standard material search across class materials.
- **Notification**: Teams activity feed via Microsoft Graph API (`TeamsActivity.Send` permission). The `verify-answer` Function calls Graph API to notify the reporting student on publish.
- **Error context**: All Functions log `subjectId`, `correctionId`, and `userId` in errors for App Insights debugging.

## Cross-Story Dependencies

- 4.1 and 4.2 depend on Story 3.3 (Report Incorrect Response) — the report is created in Epic 3's chat UI. The `report-correction` Function may live in Epic 3 or Epic 4 depending on team preference; the data model and endpoints must be shared.
- 4.3 depends on 4.2 — no verified answers exist in Pinecone until the teacher publishes them.
- 4.2 depends on Epic 9 (Infrastructure) for the Storage Queue and Table Storage resources.
- 4.2 depends on Epic 1 (Auth) for teacher identity and subject enrollment validation.
- Rate limiting middleware (5 reports/hour per student) must be implemented before 4.1 goes live.
