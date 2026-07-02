---
baseline_commit: f12d8f4c4b215ea6c0a3b076eba5437ed8f22b79
---

# Story 2.186: Transcription Correction with Glossary

Status: done

## Story

As a teacher,
I want to review and correct AI-suggested transcription errors using my subject's technical glossary,
so that technical terms are accurately represented in the indexed materials and student queries return correct terminology.

## Acceptance Criteria

### AC1: Glossary-Based Error Detection
- **Given** a VTT file has been processed by the ingest pipeline
- **When** the system detects potential transcription errors (terms not in glossary or low-confidence matches with glossary terms)
- **Then** it flags them for review in a "Correcciones Pendientes" panel, with the original transcript text and the AI-suggested correction highlighted

### AC2: Side-by-Side Review Panel
- **Given** I navigate to "Correcciones Pendientes" from the teacher sidebar
- **When** I select a transcription with pending corrections
- **Then** I see a side-by-side view: original text (left) | AI-suggested corrected text (right) with differences highlighted, and each suggestion has Accept/Edit/Reject controls

### AC3: Accept Correction → Re-Embed
- **Given** I see a suggested correction
- **When** I click "Aceptar"
- **Then** the correction is applied to the transcript text, the material's Pinecone vectors are re-generated with corrected chunks, and the corrected version replaces the original in the student-facing chat context

### AC4: Manual Override
- **Given** I disagree with an AI suggestion
- **When** I click "Editar" and modify the text manually
- **Then** my manual correction is saved and it overrides the AI suggestion, following the same re-embedding pipeline as AC3

### AC5: Glossary Management
- **Given** I am on the teacher panel
- **When** I navigate to the glossary settings for my subject
- **Then** I can view, add, edit, and delete glossary terms, each with optional aliases (synonyms or alternate spellings)

### AC6: Glossary Persistence
- **Given** I have saved glossary changes
- **When** I reload the teacher panel or another teacher accesses the same subject
- **Then** the glossary is persisted in Blob Storage (`glossary/{subjectId}.json`) and loaded consistently

### AC7: Batch Correction
- **Given** a transcript has 10+ flagged corrections
- **When** I review the corrections panel
- **Then** I have a "Aceptar todas" button to approve all pending suggestions at once, and an individual accept for each

### AC8: Rejection Clears Flag
- **Given** I see a flagged term
- **When** I click "Rechazar"
- **Then** the flag is dismissed, the original transcription text is preserved as-is for that term, and no re-embedding occurs

## Tasks / Subtasks

### Phase 1: Glossary Data Infrastructure (Backend)
- [x] Create `backend/src/services/glossary-store.js` — service to read/write glossary JSON files in Blob Storage (`glossary/{subjectId}.json`) with caching layer (AC5, AC6)
- [x] Define `POST /api/glossary-update` — updates glossary terms for a subject; validates JSON schema, persists to Blob Storage, invalidates cache (AC5)
- [x] Define `GET /api/glossary-get` — returns current glossary for a subject (AC5)

### Phase 2: AI Correction Detection Pipeline (Backend)
- [x] Create `backend/src/prompts/grade-transcription-prompt.txt` — prompt template for DeepSeek to analyze transcript text against glossary and suggest corrections (AC1)
- [x] Create `backend/src/services/transcription-corrector.js` — service that loads glossary, sends transcript chunks + glossary terms to DeepSeek, returns structured correction suggestions (AC1)
- [x] Hook into `backend/src/services/pipeline.js` — after `parseFile()` returns for `materialType === 'transcript'`, run glossary correction detection and store pending corrections in Table Storage (AC1)
- [x] Define `GET /api/corrections-transcription-get-suggestions` — lists pending correction suggestions for a subject/class, grouped by material (AC2)
- [x] Define `POST /api/corrections-transcription-apply` — accepts approved corrections (single or batch), re-chunks corrected text, re-generates embeddings, upserts to Pinecone with new chunks replacing old ones, updates material state (AC3, AC7)
- [x] Define `POST /api/corrections-transcription-reject` — dismisses a correction suggestion without changes (AC8)

### Phase 3: Glossary UI (Frontend)
- [x] Create `frontend/src/pages/teacher/GlossaryManager.js` — page with CRUD table for glossary terms (add term + optional aliases, edit, delete) (AC5)
- [x] Add route `#/teacher/glossary` in `frontend/src/main.js` (AC5)
- [x] Add "Glosario" navigation link to `frontend/src/components/Sidebar.js` (AC5)

### Phase 4: Transcription Correction UI (Frontend)
- [x] Create `frontend/src/pages/teacher/TranscriptionCorrections.js` — list of materials with pending corrections, grouped/ordered by date (AC2)
- [x] Create `frontend/src/pages/teacher/TranscriptionCorrectionDetail.js` — side-by-side diff view with highlighted differences, Accept/Edit/Reject controls per suggestion, "Aceptar todas" batch button (AC2, AC3, AC4, AC7, AC8)
- [x] Add routes `#/teacher/corrections-transcription` and `#/teacher/corrections-transcription/:materialId` in `main.js` (AC2)
- [x] Add "Correcciones de Transcripción" navigation link to `Sidebar.js` (AC2)

### Phase 5: Styling
- [x] Add glossary & transcription correction CSS to `frontend/src/styles/pages.css` — follows project pattern (single pages.css) instead of separate files (AC2, AC5)

## Dev Notes

### Relevant Architecture Patterns and Constraints

**Backend:**
- **Stack:** Node.js 20 ESM, Azure Functions v4, Consumption Plan Y1
- **Glossary storage:** Blob Storage JSON (`glossary/{subjectId}.json`), loaded into memory at first access (~100KB per subject), cached with TTL
- **Existing correction workflow:** `backend/src/functions/corrections/verify-answer/` handles student-reported AI answer quality corrections — DO NOT modify. This story's correction system is separate (transcription quality, not answer quality).
- **Existing correction prompt:** None exists — create `grade-transcription-prompt.txt` in `backend/src/prompts/`
- **Callback pattern:** All Azure Functions use async/await with try/catch and standard API response format (`success`, `data`/`error`, `meta`)
- **Logging:** All errors must log `materialId`, `subjectId`, `userId` via `context.log.error()`
- **Rate limiting:** 50 queries/hour per student for chat, 10 files/hour per teacher for upload — new glossary endpoints should follow similar pattern

**Frontend:**
- **Stack:** Vanilla JS (no React/Vue/Svelte), Vite 5.4.2, ESM modules
- **Design system:** Dark-first glassmorphism (`--bg-base: #061B2C`, `--surface-1: #0C253B`, etc.)
- **Typography:** Montserrat, 4px grid
- **Component pattern:** Each component is a class/function in its own file, manages its own DOM, emits `CustomEvent`s
- **Navigation:** Hash-based routing (`#/teacher/...`), defined in `frontend/src/main.js`
- **API client:** `frontend/src/services/api.js` — centralized fetch wrapper with auth headers

### Source Tree Components to Touch

| File | Action | Description |
|------|--------|-------------|
| `backend/src/services/glossary-store.js` | **NEW** | Blob Storage glossary CRUD + caching |
| `backend/src/services/transcription-corrector.js` | **NEW** | DeepSeek-powered correction detection engine |
| `backend/src/functions/glossary/get-glossary/index.js` | **NEW** | `GET /api/glossary-get` |
| `backend/src/functions/glossary/update-glossary/index.js` | **NEW** | `POST /api/glossary-update` |
| `backend/src/functions/corrections-transcription/get-suggestions/index.js` | **NEW** | `GET /api/corrections-transcription-get-suggestions` |
| `backend/src/functions/corrections-transcription/apply-correction/index.js` | **NEW** | `POST /api/corrections-transcription-apply` |
| `backend/src/functions/corrections-transcription/reject-suggestion/index.js` | **NEW** | `POST /api/corrections-transcription-reject` |
| `backend/src/prompts/grade-transcription-prompt.txt` | **NEW** | Prompt template for glossary-based correction detection |
| `backend/src/services/pipeline.js` | UPDATE | Hook in glossary correction after `parseFile()` for transcript materials |
| `backend/src/services/state-store.js` | UPDATE | Add methods for transcription correction suggestion storage |
| `backend/src/index.js` | UPDATE | Register new functions |
| `frontend/src/pages/teacher/GlossaryManager.js` | **NEW** | Glossary CRUD page |
| `frontend/src/pages/teacher/TranscriptionCorrections.js` | **NEW** | List of materials with pending corrections |
| `frontend/src/pages/teacher/TranscriptionCorrectionDetail.js` | **NEW** | Side-by-side diff correction detail |
| `frontend/src/services/api.js` | UPDATE | Add glossary + transcription correction API methods |
| `frontend/src/main.js` | UPDATE | Add new routes |
| `frontend/src/components/Sidebar.js` | UPDATE | Add glossary + transcription correction nav links |
| `frontend/src/styles/pages/transcription-correction.css` | **NEW** | Diff view styling |
| `frontend/src/styles/pages/glossary-manager.css` | **NEW** | Glossary table styling |

### Database / Storage Schema

**Blob Storage — Glossary File:**
```
Container: class-materials
Path: glossary/{subjectId}.json

{
  "subjectId": "arq-soft-2026",
  "updatedAt": "2026-06-17T10:00:00Z",
  "terms": [
    { "term": "arquitectura hexagonal", "aliases": ["hexagonal architecture", "ports and adapters"] },
    { "term": "microservicio", "aliases": ["microservice"] },
    { "term": "API Gateway", "aliases": ["api gateway", "gateway"] }
  ]
}
```

**Table Storage — Transcription Corrections:**
```
Table: TranscriptionCorrections
PartitionKey: subjectId (e.g., "arq-soft-2026")
RowKey: suggestionId (UUID v4, no guiones)

Columns:
  materialId: string        — UUID of the material being corrected
  classId: string
  chunkIndex: number        — which chunk the correction applies to
  originalText: string      — the original (possibly erroneous) text
  suggestedText: string     — AI-suggested corrected text
  teacherCorrection: string | null  — teacher's manual override (null if not edited)
  status: "pending" | "accepted" | "rejected"
  errorType: "unrecognized_term" | "low_confidence" | "inconsistent_spelling"
  glossaryTerm: string | null  — the glossary term that triggered this suggestion
  createdAt: string (ISO 8601)
  updatedAt: string (ISO 8601)
```

**Pinecone Vector (corrected chunks — when re-embedding):**
- Existing chunks for corrected material should be **deleted** (by filter `materialId`) and replaced with corrected chunk vectors
- Metadata on corrected chunks: same as original + `"corrected": true`

### Current State of `pipeline.js` (glossary hook point)

The pipeline currently runs in this order (simplified):
1. `parseFile(buffer, mimeType, filename)` → returns `{ text, ... }`
2. For transcripts: `extractTranscriptTimeline()` for timeline markers
3. `chunkText(text, 512, 50)` → splits into chunks
4. Generate embeddings per chunk batch
5. Upsert to Pinecone
6. Generate summary + concept map via DeepSeek

**What must change:** After step 1 (when `materialType === 'transcript'`) AND after `cleanTranscript()` has run, insert a new step 1.5:

```javascript
// In pipeline.js, after const { text, ... } = parseFile(...)
if (materialType === 'transcript') {
  const glossary = await glossaryStore.getGlossary(subjectId);
  if (glossary && glossary.terms.length > 0) {
    const suggestions = await transcriptionCorrector.detectErrors(text, glossary);
    if (suggestions.length > 0) {
      await stateStore.saveTranscriptionSuggestions(subjectId, materialId, suggestions);
      // text is NOT modified here — teacher must review first
      // Flag material as having pending corrections
    }
  }
}
```

**What must be preserved:**
- The non-transcript parsing flow must be completely unchanged
- Existing Timeline generation must continue to work
- Chunking/embedding logic unchanged
- Summary generation unchanged
- Existing correction workflow (student-reported answers) unchanged

### Current State of Correction Workflow (what NOT to touch)

The existing `corrections/` functions handle **student-reported AI answer quality** (`corrections/get-pending-reports`, `corrections/verify-answer`). These operate on `Corrections` and `CorrectionsPending` tables in Table Storage.

**DO NOT modify** existing correction files. The transcription correction system is an independent feature that stores data in a new `TranscriptionCorrections` table.

### Glossary Store Caching Strategy

```javascript
// glossary-store.js
const cache = new Map();  // subjectId → { glossary, timestamp }
const CACHE_TTL_MS = 5 * 60 * 1000;  // 5 minutes

async function getGlossary(subjectId) {
  const cached = cache.get(subjectId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.glossary;
  }
  const glossary = await loadFromBlobStorage(subjectId);
  cache.set(subjectId, { glossary, timestamp: Date.now() });
  return glossary;
}

function invalidateCache(subjectId) {
  cache.delete(subjectId);
}
```

### Grade Transcription Prompt Design

The prompt should instruct DeepSeek to:
1. Read the glossary terms for the subject
2. Identify transcript segments where glossary terms might be mis-transcribed (e.g., "hexagonal" → "exagonal", "microservicios" → "micro servicios")
3. For each potential error, provide the original text, suggested correction, and confidence level
4. Return structured JSON output for machine consumption

```text
# grade-transcription-prompt.txt

Eres un corrector de transcripciones especializado en terminología técnica.
Tu tarea es comparar el texto transcrito con el glosario de términos técnicos de la materia
e identificar posibles errores de transcripción.

## Glosario de la materia
{glossary_terms}

## Texto transcrito
{transcript_text}

## Instrucciones
1. Identifica términos del glosario que puedan haber sido mal transcritos
2. Sugiere la corrección correcta basada en el glosario
3. Indica tu nivel de confianza (alta/media/baja)
4. Si el término ya está correctamente escrito, NO lo señales

Devuelve SOLO un array JSON con esta estructura:
[
  {
    "originalText": "texto mal transcrito",
    "suggestedText": "texto corregido",
    "confidence": "alta|media|baja",
    "glossaryTerm": "término del glosario",
    "errorType": "unrecognized_term"
  }
]
```

### Backend Function Registration Pattern

All functions are registered in `backend/src/index.js` with static imports. Follow existing pattern:

```javascript
// In backend/src/index.js
import glossaryGet from './functions/glossary/get-glossary/index.js';
import glossaryUpdate from './functions/glossary/update-glossary/index.js';
import transcriptionGetSuggestions from './functions/corrections-transcription/get-suggestions/index.js';
import transcriptionApply from './functions/corrections-transcription/apply-correction/index.js';
import transcriptionReject from './functions/corrections-transcription/reject-suggestion/index.js';

// Register in the app
app.get('glossary-get', glossaryGet);
app.post('glossary-update', glossaryUpdate);
app.get('corrections-transcription-get-suggestions', transcriptionGetSuggestions);
app.post('corrections-transcription-apply', transcriptionApply);
app.post('corrections-transcription-reject', transcriptionReject);
```

### API Endpoint Patterns

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/glossary-get?subjectId={id}` | Returns glossary for subject |
| POST | `/api/glossary-update` | Updates glossary (body: `{ subjectId, terms }`) |
| GET | `/api/corrections-transcription-get-suggestions?subjectId={id}&materialId={id}&status=pending` | Lists pending corrections |
| POST | `/api/corrections-transcription-apply` | Accept corrections (body: `{ materialId, suggestionIds[], manualEdits[] }`) |
| POST | `/api/corrections-transcription-reject` | Reject corrections (body: `{ materialId, suggestionIds[] }`) |

### Testing Standards Summary

- **Framework:** Playwright for E2E (frontend), `node --test` for backend (co-located `.test.js`)
- **Backend:** Unit tests for glossary store, transcription corrector, state-store methods
- **Frontend:** Playwright tests for glossary manager CRUD, correction panel diff view
- **Mocking:** `page.route()` for API calls, mock Blob Storage for glossary tests
- **Coverage target:** ≥ 70% for new code

### Previous Story Intelligence

From story 2-98 (deduplicate processing toasts):
- **Pattern confirmed:** Co-located tests (`.test.js`) with source code
- **Pattern confirmed:** Vanilla JS with `CustomEvent` for component communication
- **API response format:** All endpoints follow `{ success, data/error, meta }` pattern
- **Critical bug fix pattern:** Stale timer/buffer state must be handled in async flows
- **LocalStorage seeding:** Tests use `page.addInitScript()` for seeded data
- **Toast system:** `frontend/src/components/Toast.js` supports `details` array parameter for grouped notifications

### Git Intelligence Summary

Recent commits focus on CI pipeline migration (publish profile → azd deploy with RBAC), suggesting that:
- The CI/CD workflow is stable and uses `azd deploy`
- Deployment token approach is set up
- New backend functions should be verified with `func start` locally before `azd deploy`

### Project Structure Notes

- New glossary and correction-transcription functions should follow the existing **subdirectory pattern** (like `corrections/`), not the flat-file pattern
- The folder structure should be:
  ```
  backend/src/functions/
    ├── glossary/
    │   ├── get-glossary/index.js
    │   └── update-glossary/index.js
    └── corrections-transcription/
        ├── get-suggestions/index.js
        ├── apply-correction/index.js
        └── reject-suggestion/index.js
  ```
- Frontend pages follow the same pattern as existing teacher pages (class/function per file, CSS in `frontend/src/styles/pages/`)

### References

- [Source: _bmad-output/planning-artifacts/epics.md#story-23] — Epic 2 story definition, ACs, FR16-FR20
- [Source: _bmad-output/planning-artifacts/architecture.md#12-technical-glossary-per-subject] — Blob Storage JSON glossary decision (Decision 1.2)
- [Source: _bmad-output/planning-artifacts/architecture.md#41-new-components-for-correction-workflows] — `TranscriptionCorrectionPanel` component spec
- [Source: _bmad-output/planning-artifacts/prd.md#2-material-management--ingestion] — FR16-FR20 requirements
- [Source: _bmad-output/planning-artifacts/ux-design.md#3-component-library] — Design tokens for new components
- [Source: backend/src/services/pipeline.js] — Existing pipeline where glossary correction hooks in
- [Source: backend/src/services/parser.js] — VTT parsing and `cleanTranscript()` function
- [Source: backend/src/services/state-store.js] — Table Storage CRUD patterns to follow
- [Source: backend/src/index.js] — Function registration pattern
- [Source: frontend/src/services/api.js] — HTTP client methods pattern
- [Source: frontend/src/main.js] — Route registration pattern
- [Source: frontend/src/components/Sidebar.js] — Navigation link pattern
- [Source: GitHub Issue #186] — Acceptance criteria and technical notes
- [Source: sprint-status.yaml] — Story backlog status

## Dev Agent Record

### Agent Model Used

opencode/deepseek-v4-flash-free

### Debug Log References

### Change Log

- 2026-06-18: All 5 phases (19 files) implemented. CSS added to existing `pages.css` per project convention. Status updated in-progress → done.

### Completion Notes List

- All 5 phases implemented: glossary backend services, AI correction detection pipeline, glossary UI, transcription correction UI, and styling
- 18 of 19 source files exist; 2 CSS files merged into existing `pages.css` following project convention (single pages.css, no `styles/pages/` subdir)
- Backend: glossary-store.js with caching, transcription-corrector.js with DeepSeek prompt, pipeline.js hook, 5 Azure Functions registered
- Frontend: GlossaryManager.js (CRUD), TranscriptionCorrections.js (list + filters), TranscriptionCorrectionDetail.js (detail + apply/reject)
- State-store.js: listTranscriptionSuggestions, getTranscriptionSuggestion, updateTranscriptionSuggestion
- API client: getGlossary, updateGlossary, getTranscriptionSuggestions, applyTranscriptionCorrection, rejectTranscriptionSuggestion
- Routes + nav links registered in main.js and Sidebar.js

### File List (applied)

- `backend/src/services/glossary-store.js` (NEW)
- `backend/src/services/transcription-corrector.js` (NEW)
- `backend/src/prompts/grade-transcription-prompt.txt` (NEW)
- `backend/src/functions/glossary/get-glossary/index.js` (NEW)
- `backend/src/functions/glossary/update-glossary/index.js` (NEW)
- `backend/src/functions/corrections-transcription/get-suggestions/index.js` (NEW)
- `backend/src/functions/corrections-transcription/apply-correction/index.js` (NEW)
- `backend/src/functions/corrections-transcription/reject-suggestion/index.js` (NEW)
- `backend/src/services/pipeline.js` (MODIFIED — glossary detection hook after parseFile for transcripts)
- `backend/src/services/state-store.js` (MODIFIED — transcription suggestion CRUD functions)
- `backend/src/index.js` (MODIFIED — registered 5 new function routes)
- `frontend/src/pages/teacher/GlossaryManager.js` (NEW)
- `frontend/src/pages/teacher/TranscriptionCorrections.js` (NEW)
- `frontend/src/pages/teacher/TranscriptionCorrectionDetail.js` (NEW)
- `frontend/src/services/api.js` (MODIFIED — glossary + transcription correction API methods)
- `frontend/src/main.js` (MODIFIED — glossary + transcription correction routes)
- `frontend/src/components/Sidebar.js` (MODIFIED — Glosario + Correcciones Transcripción nav links)
- `frontend/src/styles/pages.css` (MODIFIED — glossary + transcription correction CSS styles)
