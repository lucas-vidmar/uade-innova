# Feature: Sliding Window Chunking & Transcript Cleaning

**User Stories:** #30, #34
**Status:** Completed
**Business Impact:** Improved AI answer quality by providing cleaner context and maximizing the efficiency of the LLM's context window.

## Key Milestones
- [x] Integrated `js-tiktoken` for exact token counting.
- [x] Implemented sliding window algorithm with exact 50-token overlap.
- [x] Created `cleanTranscript` helper to strip VTT/WebVTT metadata noise.
- [x] Verified logic with 100% unit test coverage.

## Summary
The RAG pipeline now uses exact token counting instead of character-based approximations. This ensures that chunks sent to Azure OpenAI are perfectly sized for the model's limits. Additionally, transcriptions are now automatically cleaned of timestamps and technical metadata, ensuring the AI focuses only on the actual educational content.
