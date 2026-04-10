import { test } from 'node:test';
import assert from 'node:assert/strict';

function computeAnalyticsFromLogs(logs = []) {
  const questionMap = new Map();
  const frictionMap = new Map();

  for (const log of logs) {
    const question = String(log?.question || '').trim().toLowerCase();
    if (!question) continue;

    const tokens = question.split(/\s+/).filter((token) => token.length > 3);
    tokens.forEach((token) => {
      questionMap.set(token, (questionMap.get(token) || 0) + 1);
    });

    if (log?.feedback === 'negative') {
      const topic = tokens.slice(0, 2).join(' ');
      if (!topic) continue;
      const existing = frictionMap.get(topic) || { topic, unresolved: 0, queries: 0 };
      existing.unresolved += 1;
      existing.queries += 1;
      frictionMap.set(topic, existing);
    }
  }

  return {
    topQuestions: Array.from(questionMap.entries()),
    frictionTopics: Array.from(frictionMap.values()),
  };
}

test('analytics logic extracts top questions and friction topics', () => {
  const logs = [
    { question: '¿Cómo funciona SAGA?', feedback: 'negative' },
    { question: '¿Qué es hexagonal?', feedback: 'positive' },
  ];

  const result = computeAnalyticsFromLogs(logs);
  const topMap = new Map(result.topQuestions);
  const frictionTopics = result.frictionTopics.map((item) => item.topic);

  assert.equal(topMap.get('funciona'), 1);
  assert.equal(topMap.get('saga?'), 1);
  assert.ok(frictionTopics.some((topic) => topic.includes('funciona')));
});
