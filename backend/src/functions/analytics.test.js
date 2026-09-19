import { test } from 'node:test';
import assert from 'node:assert/strict';

function normalizeQuestion(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function computeAnalyticsFromLogs(logs = []) {
  const questionMap = new Map();
  const frictionMap = new Map();

  for (const log of logs) {
    const rawQuestion = String(log?.question || '').trim();
    if (!rawQuestion) continue;
    const key = normalizeQuestion(rawQuestion);

    const entry = questionMap.get(key) || { text: rawQuestion, count: 0 };
    entry.count += 1;
    questionMap.set(key, entry);

    if (log?.feedback === 'negative' || log?.feedback === 'positive') {
      const existing = frictionMap.get(key) || { topic: rawQuestion, unresolved: 0, queries: 0 };
      existing.queries += 1;
      if (log?.feedback === 'negative') existing.unresolved += 1;
      frictionMap.set(key, existing);
    }
  }

  return {
    topQuestions: Array.from(questionMap.values()),
    frictionTopics: Array.from(frictionMap.values()),
  };
}

test('analytics logic returns full question strings, not word tokens (#336)', () => {
  const logs = [
    { question: '¿Cómo funciona SAGA?', feedback: 'negative' },
    { question: '¿Cómo funciona SAGA?', feedback: 'negative' },
    { question: '¿Qué es hexagonal?', feedback: 'positive' },
  ];

  const result = computeAnalyticsFromLogs(logs);
  const topMap = new Map(result.topQuestions.map((q) => [q.text, q.count]));
  const frictionTopics = result.frictionTopics.map((item) => item.topic);

  assert.equal(topMap.get('¿Cómo funciona SAGA?'), 2);
  assert.equal(topMap.get('¿Qué es hexagonal?'), 1);
  assert.ok(!topMap.has('funciona'), 'must not emit single-word tokens');
  assert.ok(!topMap.has('como'), 'must not emit stop-word tokens');
  const saga = result.frictionTopics.find((item) => item.topic === '¿Cómo funciona SAGA?');
  assert.ok(saga, 'friction topic keeps the full question');
  assert.equal(saga.queries, 2);
  assert.equal(saga.unresolved, 2);
});
