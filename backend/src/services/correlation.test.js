import { test } from 'node:test';
import assert from 'node:assert';
import { resolveCorrelationId, buildDependencyHeaders, withCorrelationResponseHeaders } from './correlation.js';

test('resolveCorrelationId keeps valid incoming header', () => {
    const request = {
        headers: {
            get: (name) => (name === 'x-correlation-id' ? 'abc-123.trace' : null),
        },
    };

    assert.strictEqual(resolveCorrelationId(request), 'abc-123.trace');
});

test('resolveCorrelationId generates new id for invalid value', () => {
    const request = {
        headers: {
            get: () => '  ',
        },
    };

    const generated = resolveCorrelationId(request);
    assert.ok(typeof generated === 'string');
    assert.ok(generated.length > 10);
});

test('dependency and response headers include correlation id', () => {
    const headers = buildDependencyHeaders('trace-789');
    assert.strictEqual(headers['x-correlation-id'], 'trace-789');

    const responseHeaders = withCorrelationResponseHeaders('trace-789', { 'Content-Type': 'application/json' });
    assert.strictEqual(responseHeaders['x-correlation-id'], 'trace-789');
    assert.strictEqual(responseHeaders['Content-Type'], 'application/json');
});
