---
stepsCompleted:
  - step-01-validate-prerequisites
  - step-02-design-epics
  - step-03-create-stories
  - step-04-final-validation
inputDocuments:
  - /Users/lucasvidmar/Documents/azure-educational-dashboard/_bmad-output/planning-artifacts/prd.md
  - /Users/lucasvidmar/Documents/azure-educational-dashboard/_bmad-output/planning-artifacts/architecture.md
  - /Users/lucasvidmar/Documents/azure-educational-dashboard/DESIGN.md
  - GitHub Issues (50+ existing issues)
  - /Users/lucasvidmar/Documents/azure-educational-dashboard/test-report/use-cases-report.md
revision: 4
revisionNotes: "Rev 4: Appended Epic 11 (Post-Test Remediation) from use-cases-report.md audit — 40 PARTIAL/FAIL items restructured into 5 sub-epics across all 8 domains. Pre-existing Epics 1-10 unmodified from Rev 3."
---

# UADE Innova - Epic Breakdown (Revised v4)

> **Rev 4 note:** Epics 1-10 are identical to Rev 3. Epic 11 is new, generated from the 54-use-case test audit (`test-report/use-cases-report.md`).

## Overview

This document provides the complete epic and story breakdown for UADE Innova, incorporating feedback from multi-agent architectural and product review.

**Key Changes from v3:**
- **Epic 11 added:** Post-Test Quality Remediation — 5 sub-epics covering the 31 PARTIAL and 9 FAIL items identified in the 54-use-case Playwright audit
- All Epics 1-10 content from Rev 3 preserved unchanged

## Epic 1: Authentication & Access Control
*(Unchanged from Rev 3)*

**User Outcome:** Users authenticate securely and access only authorized content based on their role and enrollment.
**FRs covered:** FR1, FR2, FR3, FR4, FR5
**GitHub Issues:** #24, #106, #194, #195

### Story 1.1a: Entra ID SSO Integration
As a user, I want to log in with my UADE institutional account, so that I don't need a separate password.

**Acceptance Criteria:**
**Given** I click "Iniciar sesión con UADE"
**When** I am redirected to Microsoft Entra ID
**Then** I authenticate with my UADE credentials
**And** I am redirected back to the dashboard with a valid JWT token

**Given** I am not authenticated
**When** I try to access any page other than login
**Then** I am redirected to the login page

### Story 1.1b: Enrollment Validation
As a student, I want the system to verify I'm enrolled in a subject before accessing its chat, so that I only see relevant materials.

**Acceptance Criteria:**
**Given** I am authenticated via Entra ID
**When** I attempt to open the chat for a subject
**Then** the system queries the `Enrollments` table
**And** allows access only if status="active"

**Given** I am not enrolled in a subject
**When** I try to access its chat
**Then** the API returns 403 Forbidden
**And** the UI shows: "No estás matriculado en esta materia."

### Story 1.2: Role-Based Dashboard Routing
As a user, I want to see the dashboard appropriate for my role, so that I access only relevant features.

**Acceptance Criteria:**
**Given** I successfully authenticate
**When** the system reads my role
**Then** I am redirected to /student, /teacher, /director, or /admin dashboard

**Given** I am a teacher
**When** I access the teacher dashboard
**Then** the sidebar only shows subjects where I have role="teacher"

### Story 1.3: AI Content Consent
As a student, I want to accept terms of use before my first chat, so that I explicitly consent to AI-generated content storage.

**Acceptance Criteria:**
**Given** I am a newly authenticated student
**When** I click "Usar el chat" for the first time
**Then** a modal appears with terms of use and consent checkbox

**Given** I have accepted the terms
**When** I return to the platform
**Then** the modal does not appear again

## Epic 2: Enhanced Material Ingestion & Transcription Correction
*(Unchanged from Rev 3)*

**User Outcome:** Teachers upload and correct materials efficiently, with AI-assisted transcription fixes and priority controls.
**FRs covered:** FR6-FR20
**GitHub Issues:** #1, #154, #155, #156, #161, #163, #164, #165, #186, #187

### Story 2.1: Bulk Material Upload
As a teacher, I want to upload multiple files at once and associate them with a class, so that I can prepare a lesson efficiently.

**Acceptance Criteria:**
**Given** I am on the teacher dashboard
**When** I click "Cargar materiales" and select a class
**Then** I can drag-and-drop up to 5 files simultaneously

**Given** files are selected
**When** I choose the material type for each
**Then** each file is queued for processing with its metadata

### Story 2.2: Material Processing Pipeline
As a teacher, I want the system to automatically extract text, chunk, embed, and store my uploaded materials, so that students can query them.

**Acceptance Criteria:**
**Given** a file is uploaded to Blob Storage
**When** the ingest-material Function triggers
**Then** the file is parsed based on MIME type

**Given** text is extracted
**When** the chunking runs
**Then** it produces chunks of 512 tokens with 50 token overlap

**Given** chunks are generated
**When** embeddings are created
**Then** each chunk is upserted to Pinecone with metadata

### Story 2.3: Transcription Correction with Glossary
As a teacher, I want to review and correct AI-suggested transcription errors using my subject's technical glossary.

**Acceptance Criteria:**
**Given** a VTT file has been processed
**When** the system detects potential transcription errors
**Then** it flags them for review

**Given** I navigate to "Correcciones Pendientes"
**When** I view a transcription
**Then** I see side-by-side original and corrected text

### Story 2.4: Material Priority Override
As a teacher, I want to mark certain materials as higher priority, so that the RAG system retrieves them first.

### Story 2.5: Actionable Error Handling
As a teacher, I want clear error messages when a material fails processing, so that I know how to fix it.

### Story 2.6: Teacher Onboarding
As a teacher using the platform for the first time, I want a guided tour of the upload and correction features.

## Epic 3: Conversational RAG Experience
*(Unchanged from Rev 3)*

**User Outcome:** Students ask questions and receive contextual, cited answers based exclusively on class materials.
**FRs covered:** FR21-FR31
**GitHub Issues:** #126, #127, #128, #160, #169, #170, #171, #188, #189, #190, #191, #192

### Story 3.1: Core RAG Chat with Filtering
As a student, I want to ask questions about my class materials and receive accurate, contextual answers.

### Story 3.2a: Response Rating
As a student, I want to rate chat responses, so that the system learns which answers are helpful.

### Story 3.2b: Save Conversation Threads
As a student, I want to save chat conversations, so that I can review them later for studying.

### Story 3.3: Report Incorrect Response
As a student, I want to report when a chat answer is wrong, so that the teacher can fix it.

### Story 3.5: Source Transparency in RAG Responses
As a student, I want to see exactly which material and chunk each part of the answer comes from, so that I can verify the information.

### Story 3.6: Student Onboarding
As a student using the platform for the first time, I want a guided tour of the chat features.

## Epic 4: Content Quality Assurance Workflow
*(Unchanged from Rev 3)*

**User Outcome:** Students report incorrect answers; teachers verify and publish corrections that improve future responses.
**FRs covered:** FR32-FR35
**GitHub Issues:** #135, #136, #137

### Story 4.1: Teacher Correction Inbox
As a teacher, I want to see all reported incorrect answers in one place, filtered by class.

### Story 4.2: Verify and Publish Corrected Answer
As a teacher, I want to provide a corrected answer for a reported response.

### Story 4.3: Verified Answer Boost in RAG
As a student, I want teacher-verified answers to appear first when I ask similar questions.

## Epic 5: Smart Notifications & Academic Engagement
*(Unchanged from Rev 3)*

**User Outcome:** Students and teachers receive timely, relevant notifications about deadlines, materials, and corrections.
**FRs covered:** FR36-FR48
**GitHub Issues:** #92, #93, #103, #104, #105, #113, #133, #134, #138, #139, #140, #193

### Story 5.1: Teacher Material Upload Reminders
### Story 5.2: Student Deadline and Material Alerts
### Story 5.3: Notification Preferences
### Story 5.4a: Academic Timeline and Material Browser
### Story 5.4b: AI-Generated Class Summary

## Epic 6: Director Analytics & Operational Intelligence
*(Unchanged from Rev 3)*

**User Outcome:** Directors monitor adoption, costs, and intervention signals with actionable dashboards and exports.
**FRs covered:** FR49-FR58
**GitHub Issues:** #141, #142, #143, #145, #157, #158, #159, #176, #177, #178, #179, #180

### Story 6.1: Adoption and Cost Dashboard
### Story 6.2: Student Intervention Signals
### Story 6.3: Compliance Export

## Epic 7: Platform Observability
*(Unchanged from Rev 3)*

**User Outcome:** The platform emits telemetry, monitors vector health, and tracks latency for operational awareness.
**FRs covered:** FR59-FR63
**NFRs covered:** NFR1-NFR28
**GitHub Issues:** #99, #100, #101, #108, #116, #120, #121, #122, #123, #124, #125, #146, #147, #148, #149, #150, #151, #152, #153, #166, #167, #168, #173, #174, #175

### Story 7.1: RAG Latency and Custom Metrics
### Story 7.2: Vector Health and Budget Alerts

## Epic 8: Extensible Parser Architecture
*(Unchanged from Rev 3 — Post-MVP)*

## Epic 9: Infrastructure Foundation
*(Unchanged from Rev 3)*

### Story 9.1: Bicep Provisioning for New Resources
### Story 9.2: Key Vault Secrets for Graph API
### Story 9.3: Timer and Queue Trigger Configuration

## Epic 10: Production Hardening & Tech Debt
*(Unchanged from Rev 3)*

### Story 10.1: Stream Multipart Uploads to Blob Storage (OOM Fix)
### Story 10.2: Validate Content Encoding for Transcript Files (File Spoofing Fix)
### Story 10.3: Abort LLM Stream on Client Disconnect (Token Waste Fix)
### Story 10.4: Disable Mock Auth Fallback in Production (Auth Hardening)
### Story 10.5: Exclude Mock Data from Production Bundle (Bundle Size Fix)

---
---

# Epic 11: Post-Test Quality Remediation

**User Outcome:** All 54 audited use cases function correctly — the 31 PARTIAL items become fully functional, and the 9 FAIL items are implemented and verified.

**Source:** `test-report/use-cases-report.md` (Jun 23, 2026) — Playwright audit of 54 use cases across 3 roles (student, teacher, director).

**Scope:** 40 remediation items organized into 5 sub-epics by functional domain. Each story addresses a specific PARTIAL or FAIL finding with its own ACs.

**Success Criteria:**
- 0 remaining PARTIAL items (all 31 elevated to PASS)
- 0 remaining FAIL items (all 9 implemented and PASS)
- Re-audit via Playwright confirms all 54 use cases as PASS

**Implementation Order:** Sub-epics are independent and parallelizable, except 11.3 which depends on 11.1 (chat infrastructure must work before adding chat features).

---

## Sub-Epic 11.1: Chat & Feedback Infrastructure Fixes

**Scope:** Use cases #1, #2, #3, #5, #22, #45, #47, #53 — 8 items related to chat interaction, feedback UI, and consent flow.

### Story 11.1.1: Persistent AI Consent Across Sessions
**Source:** Technical finding from report — "localStorage se sobreescribe por la respuesta del backend"
**Current status:** 🟡 PARTIAL (chat blocked until user manually accepts terms each time)

As a student, I want my AI consent choice to persist across sessions, so that I don't have to re-accept terms every time I use the chat.

**Acceptance Criteria:**
**Given** I have accepted the AI consent terms in a previous session
**When** I log in again and navigate to the chat
**Then** the consent modal does NOT appear
**And** I can immediately type questions

**Given** the backend consent API returns `{ accepted: false }`
**When** a local `accepted: true` record exists
**Then** the local record takes precedence (backend is not authoritative for consent revocation)
**And** a warning is logged: "Consent local difiere del backend — se usó valor local"

**Given** I explicitly revoke consent from settings
**When** I click "Revocar consentimiento"
**Then** both localStorage and backend are set to `false`
**And** the chat is disabled until re-consent

### Story 11.1.2: "Reportar Respuesta Incorrecta" Button in ChatWidget
**Source:** Use case #1 — "No hay botón Reportar visible sin enviar un mensaje primero"
**Current status:** 🟡 PARTIAL

As a student, I want a persistent "Reportar respuesta incorrecta" button visible on every assistant response, so that I can flag bad answers immediately.

**Acceptance Criteria:**
**Given** I receive any assistant response in the chat
**When** I view the response bubble
**Then** a "Reportar respuesta incorrecta" button is visible below the response text
**And** clicking it opens a modal with: original question (read-only), AI response (read-only), textarea "¿Qué esperabas?" (required, min 10 chars), "Enviar reporte" button

**Given** I am in a multi-turn conversation
**When** I scroll back to previous responses
**Then** each prior response retains its own report button

### Story 11.1.3: Thumbs-Up/Down Feedback Always Visible
**Source:** Use case #2 — "botones thumbs-up/down aparecen solo después de recibir una respuesta"
**Current status:** 🟡 PARTIAL

As a student, I want thumbs-up and thumbs-down buttons visible on every assistant response from the moment it renders, so that I can rate answers immediately.

**Acceptance Criteria:**
**Given** a response is rendered in the chat
**When** I view the response
**Then** a thumbs-up and thumbs-down button are visible and clickable
**And** clicking thumbs-down triggers a follow-up prompt: "¿Qué esperabas?" (optional text)

**Given** I click thumbs-up
**When** the rating is recorded
**Then** the button changes to a filled state to indicate it was rated
**And** a toast confirms: "Respuesta calificada"

### Story 11.1.4: Report Material Mismatch / Missing Info from Chat
**Source:** Use cases #5, #22 — "No hay botón explícito de reportar falta de información"
**Current status:** 🟡 PARTIAL

As a student, I want to report when the chat can't find information I know exists in the materials, so that the teacher can fix the gap.

**Acceptance Criteria:**
**Given** the chat returns "No encontré información suficiente" or a response with low confidence
**When** I see the low-confidence response
**Then** a "Reportar información faltante" button appears below the response
**And** clicking it opens a modal with: "¿Qué información esperabas encontrar?" (textarea, required), "¿En qué clase/material?" (optional class selector)

**Given** I submit a "missing info" report
**When** the system processes it
**Then** a record is created in `Corrections` with `type="missing-info"`
**And** the teacher receives a notification with the student's query and the reported gap

### Story 11.1.5: Chat Query About Weekly Deadlines
**Source:** Use case #45 — "Depende de que el consentimiento IA esté aceptado"
**Current status:** 🟡 PARTIAL

As a student, I want the chat to answer "¿qué entregas tengo esta semana?" using my enrolled subjects' deadlines, so that I don't need to switch to the calendar view.

**Acceptance Criteria:**
**Given** I ask a question about upcoming deadlines
**When** the RAG pipeline processes it
**Then** the system augments the prompt with deadlines from the current week
**And** the response includes: task name, due date, subject, and link to the task detail

**Given** I have no deadlines this week
**When** I ask about upcoming deadlines
**Then** the response shows: "No tenés entregas esta semana. Tu próxima entrega es [TaskName] el [Date]."

### Story 11.1.6: Glossary Lookup from Chat
**Source:** Use case #47 — "Requiere chat funcional"
**Current status:** 🟡 PARTIAL

As a student, I want the chat to look up technical terms from the teacher's glossary when I ask "¿qué significa [acrónimo]?", so that I get definitions without leaving the chat.

**Acceptance Criteria:**
**Given** I ask "¿qué significa [término]?" in the chat
**When** the RAG pipeline processes the query
**Then** it first checks the glossary for the subject
**And** if the term exists, returns the definition with a "📖 Glosario" badge
**And** if the term does NOT exist, returns "No encontré ese término en el glosario de la materia. ¿Querés preguntarle al docente que lo agregue?"

---

## Sub-Epic 11.2: Grade Disputation & Task Management

**Scope:** Use cases #10, #11, #16 — 3 items related to grade disputation, task creation, and task-class linking.

### Story 11.2.1: Grade Disputation UI
**Source:** Use case #10 — "No existe UI de disputa de notas"
**Current status:** ❌ FAIL

As a student, I want to dispute a grade from the tasks page when I believe it's incorrect, so that the teacher can review and correct it.

**Acceptance Criteria:**
**Given** I am on the "Tareas y Notas" page viewing completed tasks with grades
**When** I hover over a graded task
**Then** a "Disputar nota" button appears next to the grade

**Given** I click "Disputar nota"
**When** the modal opens
**Then** it shows: task name, current grade (read-only), textarea "Explicá por qué creés que la nota debería revisarse" (required, min 20 chars)
**And** a "Enviar disputa" button

**Given** I submit a dispute
**When** the system processes it
**Then** a notification is sent to the teacher: "El alumno [Name] disputó la nota de [TaskName]"
**And** the task status changes to "disputed" with a 🟡 badge

**Given** the teacher resolves the dispute
**When** the grade is updated or the dispute is rejected
**Then** I receive a notification: "Tu disputa de [TaskName] fue [resuelta|rechazada]"

### Story 11.2.2: Teacher Task Creation with Deadline
**Source:** Use case #11 — "requiere data del backend"
**Current status:** 🟡 PARTIAL

As a teacher, I want to create tasks with deadlines from the teacher dashboard so that my students see them in their task list.

**Acceptance Criteria:**
**Given** I am on the teacher dashboard
**When** I click "Crear tarea"
**Then** a form appears with: title (required), description (optional), class selector (optional, multi), weight/percentage (0-100), due date (required), subject (auto-filled)

**Given** I submit the task
**When** the system processes it
**Then** the task appears in all enrolled students' "Tareas y Notas" pages
**And** a notification is sent: "Nueva tarea: [Title] — Fecha: [Date]"

### Story 11.2.3: Task-to-Class Linking in Teacher UI
**Source:** Use case #16 — "modelo de datos soporta classIds pero UI no visible"
**Current status:** 🟡 PARTIAL

As a teacher, I want to link a task to specific classes when creating it, so that students can find the relevant materials for each task.

**Acceptance Criteria:**
**Given** I am creating or editing a task
**When** I click "Vincular a clases"
**Then** a multi-select list of all classes for the subject appears
**And** I can select one or more classes

**Given** a task is linked to classes
**When** a student views the task
**Then** the task detail shows "Materiales relacionados" with links to each linked class

---

## Sub-Epic 11.3: Multimodal Content Delivery (TTS & Concept Maps)

**Scope:** Use cases #30, #31 — 2 items related to audio player and concept map rendering.

### Story 11.3.1: TTS Audio Player Component
**Source:** Use case #30 — "No se encontró UI de reproductor de audio/podcast"
**Current status:** ❌ FAIL

As a student, I want to listen to an AI-generated audio summary of a class, so that I can study hands-free.

**Acceptance Criteria:**
**Given** I am on a class detail page (`/student/class/{classId}`)
**When** the class has a TTS audio available (status=ready)
**Then** an audio player component is visible with: play/pause button, progress bar, download link
**And** the player shows "Podcast de la clase — [ClassName]"

**Given** I click play
**When** the audio streams from `GET /api/class-audio/{classId}`
**Then** the player shows elapsed time and total duration
**And** I can seek to any position

**Given** the class does NOT have TTS audio yet
**When** the class detail loads
**Then** a "Generar audio" button is visible (if summaryReady=true)
**And** clicking it triggers TTS generation and shows a progress indicator

### Story 11.3.2: Concept Map (Mermaid) Renderer
**Source:** Use case #31 — "No se encontró UI de mapa conceptual"
**Current status:** ❌ FAIL

As a student, I want to see an interactive concept map of a class, so that I can visualize relationships between topics.

**Acceptance Criteria:**
**Given** I am on a class detail page
**When** the class has a concept map available
**Then** a Mermaid.js diagram is rendered showing concepts as nodes and relationships as edges
**And** the diagram is responsive (scales to container width)

**Given** the concept map is generated
**When** I hover over a node
**Then** the node highlights and a tooltip shows the concept description

**Given** the class does NOT have a concept map
**When** the class detail loads
**Then** a "Generar mapa conceptual" button is visible (if summaryReady=true)

---

## Sub-Epic 11.4: Teacher Curator Workflows

**Scope:** Use cases #8, #19, #20, #21, #23, #25, #26, #27, #28, #29, #32, #40, #41, #48, #49, #51 — 16 items related to teacher curation, validation, and material management.

### Story 11.4.1: Student-Initiated Transcription Issue Report
**Source:** Use case #8 — "flujo de reporte del alumno → inbox del profesor existe a nivel de API"
**Current status:** 🟡 PARTIAL

As a student, I want to report a transcription issue (timestamps, text errors) from the class detail page, so that the teacher can fix it.

**Acceptance Criteria:**
**Given** I am viewing a class detail with a transcript
**When** I select text in the transcript
**Then** a floating toolbar appears with "Reportar error de transcripción"

**Given** I click "Reportar error de transcripción"
**When** the modal opens
**Then** it shows: selected text, textarea "Corrección sugerida" (required), timestamp (auto-detected from VTT if applicable)

**Given** I submit the report
**When** the system processes it
**Then** it appears in the teacher's "Correcciones Transcripción" inbox
**And** the teacher can accept, edit, or reject

### Story 11.4.2: "Master Source" Toggle in Upload Form
**Source:** Use case #19 — "toggle no visible sin datos cargados"
**Current status:** 🟡 PARTIAL

As a teacher, I want to mark a bibliography upload as "Fuente Maestra" directly in the upload form, so that I don't need to edit metadata after uploading.

**Acceptance Criteria:**
**Given** I have selected "Bibliografía" as the material type in the upload form
**When** the form renders
**Then** a toggle "Marcar como Fuente Maestra" appears below the file selector
**And** a tooltip explains: "Las fuentes maestras tienen prioridad en las respuestas del chat"

**Given** I toggle "Fuente Maestra" ON and upload
**When** the pipeline processes the file
**Then** the chunks are upserted with `materialPriority: "primary"`

### Story 11.4.3: Material Delete Confirmation and Cascade
**Source:** Use case #20 — "UI depende de que haya materiales listados"
**Current status:** 🟡 PARTIAL

As a teacher, I want to delete a material with a confirmation dialog that explains the consequences, so that I don't accidentally remove content students are using.

**Acceptance Criteria:**
**Given** I click "Eliminar" on a material in "Gestión de Materiales"
**When** the delete dialog opens
**Then** it shows: filename, material type, associated class(es), warning "Se eliminarán [N] chunks del índice vectorial. Los alumnos perderán acceso a este contenido."
**And** buttons: "Cancelar" and "Eliminar definitivamente" (red, requires confirmation checkbox)

**Given** I confirm deletion
**When** the system processes it
**Then** all vectors for that material are deleted from Pinecone
**And** the blob is moved to a `deleted/` container (soft-delete, 30-day retention)

### Story 11.4.4: Reprocess Button for Failed Materials
**Source:** Use case #21 — "UI de reprocesamiento visible cuando hay materiales con status error"
**Current status:** 🟡 PARTIAL

As a teacher, I want to see a "Reintentar" button on materials that failed processing, so that I can recover them without re-uploading.

**Acceptance Criteria:**
**Given** a material has status="error"
**When** I view it in "Gestión de Materiales"
**Then** a "Reintentar" button is visible alongside the error message
**And** clicking it calls `POST /api/materials/{materialId}/reprocess`

**Given** I click "Reintentar"
**When** the reprocessing starts
**Then** the status changes to "processing"
**And** I see a progress indicator

### Story 11.4.5: Inline Text Editor for Extracted Transcripts
**Source:** Use case #23 — "UI de edición de texto depende de selección de material"
**Current status:** 🟡 PARTIAL

As a teacher, I want to edit the extracted text of a transcript inline, so that I can fix OCR/ASR errors directly.

**Acceptance Criteria:**
**Given** I open a material's detail view
**When** the material type is "transcript"
**Then** the extracted text is displayed in an editable textarea
**And** a "Guardar cambios" button is visible

**Given** I edit the text and click "Guardar cambios"
**When** the system processes the update
**Then** the new text is saved via `PUT /api/materials/{materialId}/text`
**And** the chunks are re-generated and re-embedded in Pinecone

### Story 11.4.6: Summary Approval/Rejection with Editable Preview
**Source:** Use cases #25, #26 — "requiere que el material esté procesado"
**Current status:** 🟡 PARTIAL

As a teacher, I want to approve, reject, or edit an AI-generated class summary before publishing, so that students see accurate summaries.

**Acceptance Criteria:**
**Given** a class has all materials in "ready" status
**When** I navigate to the class detail
**Then** a "Resumen generado por IA" section shows the summary with: "Aprobar" (green), "Editar" (blue), "Rechazar y regenerar" (red) buttons

**Given** I click "Editar"
**When** the editor opens
**Then** I can modify the summary text directly
**And** click "Guardar y publicar"

**Given** I click "Rechazar y regenerar"
**When** the system processes it
**Then** the summary is regenerated using a different prompt temperature (0.5 → 0.7)
**And** the new version replaces the previous one

### Story 11.4.7: Milestone Curation in Class Timeline
**Source:** Use case #27 — "requiere UI de timeline en class detail"
**Current status:** 🟡 PARTIAL

As a teacher, I want to review, add, and remove milestones (key questions, definitions, task assignments) detected in the class transcript, so that the student timeline is accurate.

**Acceptance Criteria:**
**Given** I am viewing a class with a processed transcript
**When** I click "Editar hitos"
**Then** I see a list of detected milestones with timestamps, each with: checkbox (keep/remove), editable text, "Agregar hito manualmente" button

**Given** I delete a milestone
**When** I click "Guardar"
**Then** the timeline is updated via `POST /api/class-timeline/{classId}`

### Story 11.4.8: Topic Tags Management
**Source:** Use case #28 — "Tags management disponible en el editor de clases"
**Current status:** 🟡 PARTIAL

As a teacher, I want to add and remove topic tags for a class, so that the RAG system can filter by topic.

**Acceptance Criteria:**
**Given** I am editing a class
**When** I click "Administrar tags"
**Then** I see existing tags as removable chips and an input to add new tags
**And** suggested tags from the transcript content are shown below

**Given** I add a tag
**When** I save
**Then** the tag is indexed in Pinecone metadata for all chunks in that class

### Story 11.4.9: Mark Summary as "Not Suitable"
**Source:** Use case #29 — "UI de 'no apto' está en la vista de validación del docente"
**Current status:** 🟡 PARTIAL

As a teacher, I want to mark an AI-generated summary as "not suitable" so that it is NOT published and a manual summary can be written instead.

**Acceptance Criteria:**
**Given** I am reviewing a class summary
**When** I click "No apto — escribir manualmente"
**Then** a full text editor opens (not just an edit field)
**And** I can write a complete summary from scratch
**And** when saved, the `summaryReady` flag is set to `true` but a `summarySource: "manual"` metadata tag is stored

### Story 11.4.10: Retroactive Content Publication
**Source:** Use case #32 — "Timer-triggered function notifica a alumnos"
**Current status:** ✅ Note: this backend function exists; the frontend trigger needs verification

As a teacher, I want to publish content for a past class and have all enrolled students notified, so that late uploads don't go unnoticed.

**Acceptance Criteria:**
**Given** I upload materials for a class whose date has passed
**When** the materials reach status="ready"
**Then** the `post-class-summary-dispatcher` timer function detects the late publication
**And** all enrolled students receive a notification: "Nuevos materiales disponibles para [ClassName] (fecha original: [Date])"

**Given** I manually publish a summary for a past class
**When** I click "Publicar ahora"
**Then** the same notification flow is triggered immediately (not waiting for the timer)

### Story 11.4.11: Exam Date Modification
**Source:** Use case #40 — "Gestor de clases permite edición de fechas"
**Current status:** 🟡 PARTIAL

As a teacher, I want to modify an exam or deadline date and have all affected students notified, so that schedule changes are communicated immediately.

**Acceptance Criteria:**
**Given** I edit a deadline/exam date
**When** I save the change
**Then** all enrolled students receive a notification: "Fecha actualizada: [TaskName] ahora vence el [NewDate]"
**And** the calendar view reflects the new date

### Story 11.4.12: Add New Class to Schedule
**Source:** Use case #41 — "Gestor de clases tiene formulario de creación"
**Current status:** 🟡 PARTIAL

As a teacher, I want to add a new class to the schedule from the class manager, so that the timeline stays up to date.

**Acceptance Criteria:**
**Given** I am in the "Gestor de Clases"
**When** I click "Agregar clase"
**Then** a form appears with: title (required), date (required), topics (multi-tag input, optional)
**And** a "Guardar" button

**Given** I save the new class
**When** the system processes it
**Then** the class appears in the student timeline
**And** a "Clase agregada: [Title]" toast is shown

### Story 11.4.13: Transcription Suggestion Auto-Detect & Batch Apply
**Source:** Use cases #48, #49 — "UI de sugerencias automáticas depende del pipeline"
**Current status:** 🟡 PARTIAL

As a teacher, I want the system to auto-detect transcription errors using the glossary and let me apply corrections individually or in batch, so that I can clean up transcripts efficiently.

**Acceptance Criteria:**
**Given** a VTT transcript is processed
**When** the glossary contains terms for that subject
**Then** the system scans the transcript for glossary terms that may be mis-transcribed
**And** shows suggestions in "Correcciones Transcripción" page

**Given** I view suggestions
**When** I see multiple corrections for the same term
**Then** I can "Aplicar todas" (batch) or review each individually

**Given** I apply a correction
**When** the system processes it
**Then** the corrected transcript is re-embedded in Pinecone

### Story 11.4.14: Subject Weight Configuration UI
**Source:** Use case #51 — "requiere selección de materia con datos"
**Current status:** 🟡 PARTIAL

As a teacher, I want to configure the relative weight of each material type (transcript, presentation, notes, bibliography) for RAG ranking, so that I control which sources are prioritized.

**Acceptance Criteria:**
**Given** I navigate to "Configuración de pesos" for a subject
**When** the page loads
**Then** I see sliders for each material type: transcript (default 1.0), presentation (0.95), notes (1.35), bibliography (1.1)
**And** a "Restaurar valores por defecto" button

**Given** I change a weight and save
**When** the system updates
**Then** subsequent RAG queries use the new weights for ranking
**And** the change is stored in `SubjectWeights` table

### Story 11.4.15: Calendar ICS Export Button
**Source:** Use case #42 — "Botón de exportación .ics no visible en la UI actual"
**Current status:** 🟡 PARTIAL

As a student, I want to export my class schedule and deadlines to Google Calendar / Outlook, so that I have all academic dates in my personal calendar.

**Acceptance Criteria:**
**Given** I am on the calendar page
**When** I click "Exportar calendario"
**Then** a dropdown shows: "Google Calendar", "Outlook Calendar", "Descargar .ics"
**And** clicking any option triggers the respective export flow

---

## Sub-Epic 11.5: Student Configuration & Personalization

**Scope:** Use cases #38, #39, #42, #50, #52 — 5 items related to student settings, risk thresholds, keyword reporting, and bot personalization.

### Story 11.5.1: Bot Tone and Response Length Configuration
**Source:** Use case #52 — "La página de Configuración del alumno muestra solo 'Preferencias de Recordatorios'"
**Current status:** ❌ FAIL

As a student, I want to configure the chat bot's tone (formal/didactic) and response length (concise/detailed), so that the assistant matches my learning style.

**Acceptance Criteria:**
**Given** I am on the student Settings page
**When** I view "Preferencias del asistente"
**Then** I see:
  - "Tono de respuesta" selector: Formal (default) / Didáctico / Resumido
  - "Longitud de respuesta" selector: Concisa / Detallada (default)
  - "Incluir fuentes por defecto" toggle (ON by default)

**Given** I change a preference
**When** I click "Guardar preferencias"
**Then** the setting is stored in `UserProfiles` table
**And** future chat responses use the selected tone and length

### Story 11.5.2: Keyword/Concept Reporting from Chat
**Source:** Use case #50 — "No hay UI dedicada para que el alumno reporte palabras clave faltantes"
**Current status:** ❌ FAIL

As a student, I want to report that a specific keyword or concept is missing from the chat's knowledge, so that the teacher knows to add materials covering that topic.

**Acceptance Criteria:**
**Given** I receive a chat response that does NOT mention a concept I expected
**When** I click "Reportar concepto faltante"
**Then** a modal shows: "¿Qué concepto no encontraste?" (textarea, required), "¿En qué clase esperabas encontrarlo?" (class selector, optional)
**And** "Enviar reporte" button

**Given** I submit a keyword report
**When** the system processes it
**Then** the teacher receives: "Un alumno reportó que el concepto '[keyword]' no aparece en los materiales de [ClassName]"
**And** the report is logged with `type="missing-keyword"`

### Story 11.5.3: Student Inactivity Trigger — Dashboard Warning
**Source:** Use case #38 — "Depende de timer trigger en Azure Functions"
**Current status:** ❌ FAIL

As a student who hasn't logged in for 7+ days, I want to see a dashboard banner when I return, so that I know what I missed.

**Acceptance Criteria:**
**Given** I have not logged in for 7+ days
**When** I access the dashboard
**Then** a banner appears at the top: "🟡 No visitaste la plataforma en [N] días. Tenés [N] nuevos materiales y [N] entregas próximas."
**And** clicking the banner navigates to the notifications page

**Given** I have not logged in for 14+ days
**When** I access the dashboard
**Then** the banner is red: "🔴 Hacé mucho que no ingresás. Revisá tus tareas pendientes antes de que se venzan."

### Story 11.5.4: Risk Threshold Configuration UI
**Source:** Use case #39 — "requiere datos precargados para mostrar los controles"
**Current status:** 🟡 PARTIAL

As a director, I want to configure risk thresholds (inactivity days, minimum queries, attendance %) from the interventions page, so that alerts match my institution's criteria.

**Acceptance Criteria:**
**Given** I am on the Interventions page
**When** I click "Configurar umbrales"
**Then** I see: "Días de inactividad para riesgo bajo" (default 7), "Días de inactividad para riesgo medio" (default 14), "Días de inactividad para riesgo alto" (default 21), "Mínimo de consultas semanales" (default 2), "% asistencia mínima" (default 60%)
**And** each field has a slider or number input

**Given** I change thresholds and save
**When** the `POST /api/risk-thresholds` endpoint is called
**Then** future risk computations use the new thresholds
**And** existing interventions are NOT retroactively changed

---

## FR Coverage Map (Epic 11 additions)

| Use Case # | Epic 11 Story | Estado actual | Tipo |
|---|---|---|---|
| 1 | 11.1.2 | 🟡 PARTIAL | Chat feedback |
| 2 | 11.1.3 | 🟡 PARTIAL | Chat feedback |
| 3 | 11.1.2 | 🟡 PARTIAL | Chat feedback |
| 5 | 11.1.4 | 🟡 PARTIAL | Chat feedback |
| 8 | 11.4.1 | 🟡 PARTIAL | Teacher curation |
| 10 | 11.2.1 | ❌ FAIL | Grade disputation |
| 11 | 11.2.2 | 🟡 PARTIAL | Task management |
| 16 | 11.2.3 | 🟡 PARTIAL | Task management |
| 19 | 11.4.2 | 🟡 PARTIAL | Teacher curation |
| 20 | 11.4.3 | 🟡 PARTIAL | Teacher curation |
| 21 | 11.4.4 | 🟡 PARTIAL | Teacher curation |
| 22 | 11.1.4 | 🟡 PARTIAL | Chat feedback |
| 23 | 11.4.5 | 🟡 PARTIAL | Teacher curation |
| 25 | 11.4.6 | 🟡 PARTIAL | Teacher curation |
| 26 | 11.4.6 | 🟡 PARTIAL | Teacher curation |
| 27 | 11.4.7 | 🟡 PARTIAL | Teacher curation |
| 28 | 11.4.8 | 🟡 PARTIAL | Teacher curation |
| 29 | 11.4.9 | 🟡 PARTIAL | Teacher curation |
| 30 | 11.3.1 | ❌ FAIL | Multimodal |
| 31 | 11.3.2 | ❌ FAIL | Multimodal |
| 32 | 11.4.10 | 🟡 PARTIAL | Teacher curation |
| 38 | 11.5.3 | ❌ FAIL | Config |
| 39 | 11.5.4 | 🟡 PARTIAL | Config |
| 40 | 11.4.11 | 🟡 PARTIAL | Teacher curation |
| 41 | 11.4.12 | 🟡 PARTIAL | Teacher curation |
| 42 | 11.4.15 | 🟡 PARTIAL | Config |
| 45 | 11.1.5 | 🟡 PARTIAL | Chat feedback |
| 47 | 11.1.6 | 🟡 PARTIAL | Chat feedback |
| 48 | 11.4.13 | 🟡 PARTIAL | Teacher curation |
| 49 | 11.4.13 | 🟡 PARTIAL | Teacher curation |
| 50 | 11.5.2 | ❌ FAIL | Config |
| 51 | 11.4.14 | 🟡 PARTIAL | Teacher curation |
| 52 | 11.5.1 | ❌ FAIL | Config |
| 53 | — | ✅ Already functional | — |
| 54 | — | ✅ Already functional | — |

## Dependency Analysis (Epic 11)

```
Sub-Epic 11.1 (Chat Infrastructure) ──┐
                                       ├── Sub-Epic 11.3 (Multimodal)
Sub-Epic 11.2 (Grades & Tasks) ────────┤
                                       ├── Sub-Epic 11.4 (Teacher Curation)
Sub-Epic 11.5 (Student Config) ────────┘
```

**Critical Path:** 11.1 → 11.3 (11.3 requires chat consent fix first)
**Parallelizable:** 11.2, 11.4, 11.5 (independent of each other and of 11.1 once consent fix is deployed)

**Total Remediation Stories:** 34 (5 sub-epics, 34 stories)
**Playwright Re-audit Story:** Implicit — run `test-use-cases.mjs` after all stories are deployed and verify 54/54 PASS
