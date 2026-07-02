# Walkthrough: User Story #34

**Feature/Story Name**: Transcript Cleaning  
**Status**: Completed  
**Business Impact**: Transcript ingestion now removes subtitle transport noise (timestamps, metadata, speaker labels) before chunking, improving semantic retrieval quality for student Q&A.

## What Changed
- Hardened transcript parsing in `backend/src/services/parser.js`:
  - Added SRT recognition (`.srt`, `application/x-subrip`, `text/srt`) to text parsing flow.
  - Expanded `cleanTranscript` to remove:
    - VTT/SRT timestamp lines (`.` and `,` milliseconds)
    - VTT metadata blocks (`WEBVTT`, `NOTE`, `STYLE`, `REGION`)
    - Numeric SRT cue indices
    - Inline subtitle tags (`<v ...>`, other HTML/VTT tags)
    - Speaker prefixes (`SPEAKER_00:`, `[ALUMNO]:`, `PROFESOR:` variants)
  - Kept utterance content intact and normalized line endings for robust cross-platform parsing.
- Updated teacher upload constraints in `frontend/src/components/FileUpload.js`:
  - Transcript input now accepts `.srt` in addition to existing transcript formats.
- Added backend regression tests in `backend/src/services/parser.test.js`:
  - VTT cleanup baseline.
  - SRT timestamps + speaker label cleanup.
  - VTT metadata/inline speaker tag cleanup.
- Added Chrome usability test in `frontend/tests/transcript-cleaning-usability.spec.js`:
  - Verifies teacher upload transcript input exposes `.srt` accept pattern and successful processing UX after upload.

## Verification Results
- **Backend tests**: `npm test` (backend) — passed (105/105).
- **Frontend Chrome usability test**: `npx playwright test tests/transcript-cleaning-usability.spec.js` — passed.

## Acceptance Criteria Mapping
- **Regex cleans metadata noise**: Implemented via strengthened transcript-cleaning regex/line rules for VTT/SRT metadata, timestamps, and speaker prefixes.
- **Process `.vtt` and extract clean text block**: Existing VTT path preserved and now more robust; validated by parser unit tests.

## Backlog Refinement
- Add explicit multilingual speaker-prefix patterns (e.g., `DOCENTE`, `ESTUDIANTE`, locale abbreviations) to reduce false positives in mixed-language transcripts.
- Consider preserving optional section delimiters between cues for better downstream timeline/context stitching while still suppressing metadata.
- Add ingestion telemetry metric for “cleaning compression ratio” (raw chars vs cleaned chars) to monitor transcript quality trends.
