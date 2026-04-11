# Implementation Plan: User Story #34

**Feature/Story Name**: Transcript Cleaning  
**Status**: Completed  
**Business Impact**: Cleaner transcript chunks improve RAG relevance by removing subtitle transport noise (timestamps/labels), reducing retrieval contamination and better matching pedagogical content.

## Requirements & Constraints Analysis
- Story requires stripping subtitle metadata from classroom recordings, explicitly for VTT/SRT.
- Acceptance criterion is regex-based cleaning; implementation must preserve real spoken content while removing non-semantic scaffolding.
- Existing parser already cleans basic VTT timestamps; we must harden for broader formats without breaking timeline extraction logic.
- Zero-trust and environment constraints unaffected (pure parsing + UI accept list).

## Edge Cases Considered
- SRT timestamp notation with commas (`00:00:01,500`) and optional hour-less forms.
- VTT cue settings (e.g., `align:start position:0%`) appended to timestamp lines.
- Speaker labels in multiple shapes: `SPEAKER_00:`, `[ALUMNO]:`, `PROFESOR:`.
- VTT metadata blocks (`WEBVTT`, `NOTE`, `STYLE`, `REGION`) and BOM/line ending variants.
- Ensuring cleaned text still contains meaningful utterances and does not over-strip punctuation/content.

## Planned Milestones
- [x] Extend parser text-file detection to include SRT MIME/extensions.
- [x] Strengthen transcript regex cleaning to remove VTT/SRT timestamps, speaker labels, and metadata blocks.
- [x] Keep cleaning behavior compatible with existing pipeline parsing and chunk generation.
- [x] Add backend unit tests for SRT speakers/timestamps and richer VTT metadata noise.
- [x] Add Chrome Playwright usability test validating teacher upload flow accepts `.srt` and triggers processing UX.
- [x] Run backend and targeted frontend tests for story verification.
- [x] Publish walkthrough artifact with acceptance mapping and results.

## Out of Scope
- Diarization quality scoring or speaker identity normalization.
- Language-specific transcript correction or punctuation restoration.
- Changes to timeline marker extraction heuristics.
