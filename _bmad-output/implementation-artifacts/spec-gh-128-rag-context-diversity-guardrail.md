---
title: 'Issue #128 — RAG Context Diversity Guardrail'
type: 'feature'
created: '2026-06-19'
status: 'done'
route: 'one-shot'
context:
  - 'backend/src/functions/rag-query.js'
---

## Intent

**Problem:** When a single source file (e.g. a long transcript) contributes 3-4 of the 4 final RAG context chunks, the LLM response over-concentrates on near-duplicate passages from that one file — reducing answer breadth and missing potentially complementary content from other materials.

**Approach:** Add post-processing after `buildHybridContext` that limits chunks per source file (max 2 per file) and round-robins remaining slots when the pool lacks diversity.

## Suggested Review Order

**Core logic — diversity function**

- Pure function that groups ranked matches by source file, caps per-file contribution (2), and round-robins over-subscribed files during refill
  [`spec-gh-128-rag-context-diversity-guardrail/../../backend/src/functions/rag-query.js#L140`](../../backend/src/functions/rag-query.js#L140)

- Integration point: applies after `buildHybridContext` on line 446 — preserves type diversity then enforces file diversity
  [`spec-gh-128-rag-context-diversity-guardrail/../../backend/src/functions/rag-query.js#L447`](../../backend/src/functions/rag-query.js#L447)

- Constant `MAX_CHUNKS_PER_SOURCE = 2` defined alongside existing pipeline constants
  [`spec-gh-128-rag-context-diversity-guardrail/../../backend/src/functions/rag-query.js#L22`](../../backend/src/functions/rag-query.js#L22)
