/**
 * safety-rate.test.js — Unit tests for the Tasa Fallo Seguro service (Issue #212)
 *
 * Focuses on the pure aggregation logic (buildReport) and the safety status
 * helper, avoiding Table Storage network calls.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { buildReport } = await import('../services/safety-rate.js');
const { resolveSafetyStatus } = await import('../services/error-categories.js');

function isoDaysAgo(n) {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString();
}

function request(n, subjectId = 'arq-software-2026') {
    return { partitionKey: subjectId, eventType: undefined, timestamp: isoDaysAgo(n), promptTokens: 100 };
}

function error(n, category = 'LLM', subjectId = 'arq-software-2026') {
    return { partitionKey: subjectId, errorCategory: category, timestamp: isoDaysAgo(n) };
}

test('buildReport computes 100% safety rate when no errors', () => {
    const requests = [request(1), request(2), request(3)];
    const report = buildReport(requests, [], 30);
    assert.equal(report.totalRequests, 3);
    assert.equal(report.safeCompletions, 3);
    assert.equal(report.blockedBySafety, 0);
    assert.equal(report.errorCategorizedFailures, 0);
    assert.equal(report.safetyRatePercent, 100);
});

test('buildReport counts safety blocks and categorized failures', () => {
    const requests = [request(0), request(1), request(2), request(3), request(4), request(5), request(6), request(7), request(8), request(9), request(10)];
    const errors = [error(1, 'SAFETY'), error(2, 'SAFETY'), error(3, 'LLM')];
    const report = buildReport(requests, errors, 30);
    assert.equal(report.totalRequests, 11);
    assert.equal(report.blockedBySafety, 2);
    assert.equal(report.errorCategorizedFailures, 3);
    assert.equal(report.safeCompletions, 8);
    assert.equal(report.safetyRatePercent, 72.73);
});

test('buildReport excludes CLIENT_ABORT from categorized failures', () => {
    const requests = [request(0), request(1), request(2), request(3), request(4), request(5), request(6), request(7), request(8), request(9)];
    const errors = [error(1, 'CLIENT_ABORT'), error(2, 'RETRIEVAL_FAILURE')];
    const report = buildReport(requests, errors, 30);
    assert.equal(report.errorCategorizedFailures, 1, 'CLIENT_ABORT should not count as a system failure');
    assert.equal(report.safeCompletions, 9);
});

test('buildReport applies the 7-day window for trend comparison', () => {
    const requests = [request(1), request(2), request(10)];
    const errors = [error(1, 'SAFETY')];
    const report7 = buildReport(requests, errors, 7);
    const report30 = buildReport(requests, errors, 30);
    assert.equal(report7.totalRequests, 2, '10-day-old request falls outside 7d window');
    assert.equal(report7.errorCategorizedFailures, 1);
    assert.equal(report7.safetyRatePercent, 50);
    assert.equal(report30.totalRequests, 3);
    assert.equal(report30.safetyRatePercent, 66.67);
});

test('buildReport returns 100% when there are no requests', () => {
    const report = buildReport([], [], 30);
    assert.equal(report.totalRequests, 0);
    assert.equal(report.safetyRatePercent, 100);
});

test('resolveSafetyStatus maps thresholds green >=99, yellow >=95, red <95', () => {
    assert.equal(resolveSafetyStatus(100), 'green');
    assert.equal(resolveSafetyStatus(99), 'green');
    assert.equal(resolveSafetyStatus(98.5), 'yellow');
    assert.equal(resolveSafetyStatus(95), 'yellow');
    assert.equal(resolveSafetyStatus(94.9), 'red');
    assert.equal(resolveSafetyStatus(0), 'red');
    assert.equal(resolveSafetyStatus('n/a'), 'green');
    assert.equal(resolveSafetyStatus(undefined), 'green');
});
