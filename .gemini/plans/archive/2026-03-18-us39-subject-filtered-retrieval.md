# Implementation Plan: US39 - Subject-Filtered Retrieval

Implement a mandatory subject-level filter in the RAG retrieval pipeline to ensure students only interact with materials from their active subject, even when multiple subjects are indexed in the same Pinecone instance.

## Plan Overview
- **Total Phases**: 3
- **Agents Involved**: `coder`, `tester`, `technical_writer`
- **Estimated Effort**: Small (1-2 hours)

## Dependency Graph
```
Phase 1: RAG Logic Fix (coder)
    |
Phase 2: Validation (tester)
    |
Phase 3: Documentation (technical_writer)
```

## Execution Strategy
| Stage | Description | Agent | Mode |
|-------|-------------|-------|------|
| 1 | Refine rag-query.js filter and fix sources metadata | coder | sequential |
| 2 | Verify cross-contamination prevention with unit tests | tester | sequential |
| 3 | Update project status and feature documentation | technical_writer | sequential |

## Phase Details

### Phase 1: RAG Logic Refinement
- **Objective**: Ensure `subjectId` filter is robust and `sources` correctly map metadata.
- **Agent**: `coder`
- **Files to Modify**: 
    - `backend/src/functions/rag-query.js`: 
        - Fix `sources` mapping to use `classIds` (plural) from metadata instead of `classId`.
        - Ensure `subjectId` filter is correctly applied (current implementation is good but needs verification).
- **Validation**:
    - Build and run local backend.

### Phase 2: Quality Assurance
- **Objective**: Verify that filtering by `subjectId` works as expected and prevents cross-contamination.
- **Agent**: `tester`
- **Files to Create**:
    - `backend/src/services/rag-filter.test.js`: Mock tests for filter construction.
- **Validation**:
    - `node --test backend/src/services/rag-filter.test.js`

### Phase 3: Completion & Documentation
- **Objective**: Mark the story as completed and update docs.
- **Agent**: `technical_writer`
- **Files to Create**:
    - `docs/us39-subject-filtered-retrieval.md`
- **Files to Modify**:
    - `docs/project-status.md`: Add US39 entry.
- **Validation**:
    - Verify file existence and content.

## File Inventory
| File Path | Phase | Purpose |
|-----------|-------|---------|
| `backend/src/functions/rag-query.js` | 1 | Fix metadata mapping and ensure filter robustnes |
| `backend/src/services/rag-filter.test.js` | 2 | Unit tests for retrieval filter logic |
| `docs/us39-subject-filtered-retrieval.md` | 3 | Feature documentation |
| `docs/project-status.md` | 3 | Status tracking |

## Risk Classification
- **Phase 1**: LOW. Small logic fix.
- **Phase 2**: LOW. Pure unit tests with mocks.
- **Phase 3**: LOW. Documentation only.

## Cost Estimation
| Phase | Agent | Model | Est. Input | Est. Output | Est. Cost |
|-------|-------|-------|-----------|------------|----------|
| 1 | coder | Pro | 2000 | 500 | $0.04 |
| 2 | tester | Flash | 1500 | 800 | $0.01 |
| 3 | technical_writer | Flash | 1000 | 1000 | $0.01 |
| **Total** | | | **4500** | **2300** | **$0.06** |

## Execution Profile
- Total phases: 3
- Parallelizable phases: 0
- Sequential-only phases: 3
- Estimated parallel wall time: N/A
- Estimated sequential wall time: 10 minutes
