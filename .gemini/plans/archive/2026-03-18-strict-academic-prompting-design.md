# Design Document: Strict Academic Prompting (Issue #40)

**Problem Statement**:
As a Docente, I want the bot to respond in a formal tone and avoid hallucinating.
The current Chat RAG prompt in `backend/src/functions/rag-query.js` needs refinement to strictly enforce UADE's academic standards, professional tone, and prevent guessing or answering off-topic questions.

**Requirements**:
1. **Formal Tone**: The bot must respond in a formal, professional, and respectful Spanish (UADE style).
2. **Strict RAG**: Answers must be derived EXCLUSIVELY from the provided context in "CONTEXTO DE LOS MATERIALES".
3. **Explicit Refusal**: If information is missing, use exactly: "No encontré información sobre eso en los materiales seleccionados."
4. **Off-topic Refusal**: Decline to answer questions that are not related to the course materials or the subject.
5. **Citations**: Always cite the source (Fuente 1, etc.).

**Approach**:
Update the `system` prompt in the `rag-query.js` handler.
- **Role**: "Asistente Académico Experto del Dashboard UADE Innova".
- **Rules**: Explicit "NORMAS DE RESPUESTA (ESTRICTAS)" section.
- **Instructions**: Formal tone, no guessing, off-topic declination.

**Architecture**:
Surgical update to `backend/src/functions/rag-query.js` inside the `app.http('rag-query', ...)` handler.
The `messages` array construction will be updated with the more rigorous `system` prompt.

**Agent Team**:
- `coder`: For prompt implementation and verification tests.
- `tester`: To verify the "don't know" and refusal behaviors with simulated off-topic queries.

**Risk Assessment**:
- **Risk**: Excessive restrictiveness might lead to false refusals for valid questions.
- **Mitigation**: Retain sufficient flexibility in the prompt to acknowledge relevant context while strictly forbidding guessing outside of it.

**Success Criteria**:
- AC1: Bot says "No encontré información sobre eso en los materiales seleccionados." for missing context.
- AC2: Bot refuses off-topic questions (e.g., general knowledge or non-academic topics).
- AC3: Bot maintains a formal tone in all responses.
