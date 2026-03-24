# Feature: Context-Aware Follow-ups (User Story #45)

**Status**: Completed
**Business Impact**: Improves student usability in the tutor chat by allowing natural follow-up questions without repeating previous context.

## Key Milestones
- [x] Added automatic follow-up question rewriting using the last 3-5 chat turns.
- [x] Applied rewritten questions to retrieval so results stay aligned with prior context.
- [x] Updated frontend chat requests to send recent conversation history with each message.
- [x] Verified behavior with backend unit tests and a browser test covering follow-up flow.

## Summary
The chat now understands short follow-up prompts (for example, "Why is that important?") by expanding them into standalone questions based on recent turns. This keeps the conversation coherent for students while preserving strict subject filtering and source-grounded responses.
