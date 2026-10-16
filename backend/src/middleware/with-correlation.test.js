import { describe, test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';

mock.module('../services/correlation.js', {
  namedExports: {
    resolveCorrelationId: mock.fn((req) =>
      req?.headers?.get?.('x-correlation-id') || 'auto-gen-uuid'
    ),
    resolveTraceContext: mock.fn(() => ({
      traceparent: '00-abc123def4567890123456789abcdef0-1234567890abcdef-01',
      tracestate: null,
      traceId: 'abc123def4567890123456789abcdef0',
      spanId: '1234567890abcdef',
    })),
    buildDependencyHeaders: mock.fn((cid) => ({
      'x-correlation-id': cid,
      'traceparent': '00-abc123def4567890123456789abcdef0-newspan-01',
    })),
    withCorrelationResponseHeaders: mock.fn((cid, traceContext, baseHeaders) => ({
      ...(baseHeaders || {}),
      'x-correlation-id': cid,
      ...(traceContext ? { 'traceparent': traceContext.traceparent } : {}),
    })),
    generateCorrelationId: mock.fn(() => 'auto-gen-uuid'),
  },
});

const { withCorrelation } = await import('./with-correlation.js');

function mockRequest(headers = {}) {
  return {
    headers: {
      get: (name) => headers[name.toLowerCase()] || null,
    },
  };
}

function mockContext() {
  return { log: () => {}, error: () => {} };
}

describe('withCorrelation middleware', () => {

  test('adds correlation headers to response', async () => {
    const handler = mock.fn(async (req, ctx) => ({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    }));
    const wrapped = withCorrelation(handler);
    const result = await wrapped(mockRequest({ 'x-correlation-id': 'req-001' }), mockContext());
    assert.equal(result.status, 200);
    assert.equal(result.headers['x-correlation-id'], 'req-001');
    assert.equal(result.headers['Content-Type'], 'application/json');
  });

  test('preserves inbound correlation id', async () => {
    const handler = mock.fn(async (req, ctx) => {
      assert.equal(ctx.correlationId, 'inbound-123');
      return { status: 200, headers: {}, body: 'ok' };
    });
    const wrapped = withCorrelation(handler);
    await wrapped(mockRequest({ 'x-correlation-id': 'inbound-123' }), mockContext());
  });

  test('attaches correlationId, traceContext, dependencyHeaders to context', async () => {
    let captured;
    const handler = mock.fn(async (req, ctx) => {
      captured = { ...ctx };
      return { status: 200, headers: {}, body: 'ok' };
    });
    const wrapped = withCorrelation(handler);
    await wrapped(mockRequest({}), mockContext());
    assert.equal(typeof captured.correlationId, 'string');
    assert.equal(captured.correlationId.length > 0, true);
    assert.ok(captured.traceContext);
    assert.ok(captured.traceContext.traceparent);
    assert.ok(captured.dependencyHeaders);
    assert.equal(captured.dependencyHeaders['x-correlation-id'], captured.correlationId);
  });

  test('merges with existing custom response headers', async () => {
    const handler = mock.fn(async (req, ctx) => ({
      status: 201,
      headers: { 'x-custom': 'val', 'Content-Type': 'text/plain' },
      body: 'hello',
    }));
    const wrapped = withCorrelation(handler);
    const result = await wrapped(mockRequest({ 'x-correlation-id': 'merge-test' }), mockContext());
    assert.equal(result.status, 201);
    assert.equal(result.headers['x-custom'], 'val');
    assert.equal(result.headers['Content-Type'], 'text/plain');
    assert.equal(result.headers['x-correlation-id'], 'merge-test');
  });

  test('passes through handler throw', async () => {
    const handler = mock.fn(async () => { throw new Error('boom'); });
    const wrapped = withCorrelation(handler);
    await assert.rejects(() => wrapped(mockRequest({}), mockContext()), { message: 'boom' });
  });

  test('passes through null/undefined return', async () => {
    const handler = mock.fn(async () => undefined);
    const wrapped = withCorrelation(handler);
    const result = await wrapped(mockRequest({}), mockContext());
    assert.equal(result, undefined);
  });

  // #411: sin access-control-expose-headers el navegador no expone x-correlation-id
  // en una respuesta de otro origen y nadie puede citar la correlación de un fallo.
  test('expone la correlación a otro origen (access-control-expose-headers)', async () => {
    const handler = mock.fn(async () => ({
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'boom' }),
    }));
    const wrapped = withCorrelation(handler);
    const result = await wrapped(mockRequest({ origin: 'http://localhost:5173', 'x-correlation-id': 'req-9' }), mockContext());

    assert.equal(result.headers['x-correlation-id'], 'req-9');
    assert.equal(result.headers['access-control-allow-origin'], 'http://localhost:5173');
    assert.match(result.headers['access-control-expose-headers'], /x-correlation-id/);
  });

});
