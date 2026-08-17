import { test } from 'node:test';
import assert from 'node:assert';
import { setupTestEnv } from '../src/test-utils/env.js';

setupTestEnv();

const {
    readConfig, runCanary, queryScope, assertSourceInScope, sourceClassSet,
} = await import('./canary-rag-source-isolation.js');

const SUBJECT = 'arq-software-2026';

function baseCfg(overrides = {}) {
    const mk = (email) => ({ role: 'student', email, subjectId: SUBJECT, classIds: ['class-01'], question: 'q' });
    return {
        enabled: true,
        functionUrl: 'https://func.example.com',
        frontDoorId: 'fd-1',
        timeoutMs: 5000,
        subjectId: SUBJECT,
        classIds: ['class-01'],
        roles: {
            student: mk('student@example.com'),
            teacher: mk('teacher@example.com'),
            director: mk('director@example.com'),
            admin: mk('admin@example.com'),
        },
        ...overrides,
    };
}

function jsonResponse(status, body) {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Fetch stub that records the last request and serves a canned JSON body. */
function stubFetch(handler) {
    return async (url, init) => handler(String(url), init);
}

test('queryScope: all sources matching subjectId and classId pass (blocking mode, correct headers)', async () => {
    const cfg = baseCfg();
    const fetchImpl = stubFetch(async (url, init) => {
        assert.match(url, /\/api\/rag-query$/);
        const body = JSON.parse(init.body);
        assert.deepStrictEqual(body.classIds, ['class-01']);
        assert.strictEqual(body.stream, false);
        assert.strictEqual(init.headers['x-azure-fdid'], 'fd-1');
        assert.strictEqual(init.headers['x-ms-client-principal-name'], 'student@example.com');
        return jsonResponse(200, { sources: [
            { subjectId: SUBJECT, classId: 'class-01', classIds: ['class-01'], sourceFilename: 'a.txt' },
            { subjectId: SUBJECT, classIds: ['class-01'], sourceFilename: 'b.txt' },
        ] });
    });
    const res = await queryScope(cfg, 'student', fetchImpl);
    assert.strictEqual(res.ok, true);
});

test('queryScope: source with a single classId field is accepted (classId present, no classIds array)', async () => {
    const cfg = baseCfg();
    const fetchImpl = stubFetch(async () => jsonResponse(200, { sources: [
        { subjectId: SUBJECT, classId: 'class-01', sourceFilename: 'legacy.txt' },
    ] }));
    const res = await queryScope(cfg, 'student', fetchImpl);
    assert.strictEqual(res.ok, true);
});

test('queryScope: one source with wrong subjectId fails', async () => {
    const cfg = baseCfg();
    const fetchImpl = stubFetch(async () => jsonResponse(200, { sources: [
        { subjectId: SUBJECT, classId: 'class-01', sourceFilename: 'ok.txt' },
        { subjectId: 'otra-materia', classId: 'class-01', sourceFilename: 'leak.txt' },
    ] }));
    const res = await queryScope(cfg, 'student', fetchImpl);
    assert.strictEqual(res.ok, false);
    assert.match(res.detail, /leak\.txt/);
    assert.match(res.detail, /subjectId=otra-materia/);
});

test('queryScope: one source with wrong classId fails', async () => {
    const cfg = baseCfg();
    const fetchImpl = stubFetch(async () => jsonResponse(200, { sources: [
        { subjectId: SUBJECT, classId: 'class-01', sourceFilename: 'ok.txt' },
        { subjectId: SUBJECT, classIds: ['class-03'], sourceFilename: 'wrong-class.txt' },
    ] }));
    const res = await queryScope(cfg, 'student', fetchImpl);
    assert.strictEqual(res.ok, false);
    assert.match(res.detail, /wrong-class\.txt/);
    assert.match(res.detail, /class-03/);
});

test('queryScope: source with no classId/classIds fails (isolation unverifiable)', async () => {
    const cfg = baseCfg();
    const fetchImpl = stubFetch(async () => jsonResponse(200, { sources: [
        { subjectId: SUBJECT, sourceFilename: 'no-class.txt' },
    ] }));
    const res = await queryScope(cfg, 'student', fetchImpl);
    assert.strictEqual(res.ok, false);
    assert.match(res.detail, /no classId\/classIds/);
});

test('queryScope: empty sources[] fails (isolation unverifiable)', async () => {
    const cfg = baseCfg();
    const fetchImpl = stubFetch(async () => jsonResponse(200, { answer: 'no info', sources: [] }));
    const res = await queryScope(cfg, 'student', fetchImpl);
    assert.strictEqual(res.ok, false);
    assert.match(res.detail, /empty/);
});

test('queryScope: 401/403/429 are hard failures (auth/rate-limit blocks the scope)', async () => {
    for (const status of [401, 403, 429]) {
        const cfg = baseCfg();
        const fetchImpl = stubFetch(async () => jsonResponse(status, { error: 'denied' }));
        const res = await queryScope(cfg, 'student', fetchImpl);
        assert.strictEqual(res.ok, false, `HTTP ${status} must be a hard failure`);
        assert.match(res.detail, /hard failure/);
    }
});

test('queryScope: other non-200 response fails with status and body', async () => {
    const cfg = baseCfg();
    const fetchImpl = stubFetch(async () => jsonResponse(500, { error: 'boom' }));
    const res = await queryScope(cfg, 'student', fetchImpl);
    assert.strictEqual(res.ok, false);
    assert.match(res.detail, /500/);
});

test('queryScope: bibliography source is exempt from class match but subjectId still enforced', async () => {
    const cfg = baseCfg();
    const passing = stubFetch(async () => jsonResponse(200, { sources: [
        { subjectId: SUBJECT, materialType: 'bibliography', classIds: ['class-99'], sourceFilename: 'biblio.pdf' },
    ] }));
    const okRes = await queryScope(cfg, 'student', passing);
    assert.strictEqual(okRes.ok, true);

    const leaking = stubFetch(async () => jsonResponse(200, { sources: [
        { subjectId: 'otra-materia', materialType: 'bibliography', classIds: ['class-99'], sourceFilename: 'biblio-leak.pdf' },
    ] }));
    const leakRes = await queryScope(cfg, 'student', leaking);
    assert.strictEqual(leakRes.ok, false);
    assert.match(leakRes.detail, /subjectId=otra-materia/);
});

test('queryScope: verified-answer source is exempt from class match (subject-only pre-search) but subjectId enforced', async () => {
    const cfg = baseCfg();
    const passing = stubFetch(async () => jsonResponse(200, { sources: [
        { subjectId: SUBJECT, materialType: 'verified-answer', classId: 'class-99', sourceFilename: 'verified.txt' },
    ] }));
    const okRes = await queryScope(cfg, 'student', passing);
    assert.strictEqual(okRes.ok, true);

    const leaking = stubFetch(async () => jsonResponse(200, { sources: [
        { subjectId: 'otra-materia', materialType: 'verified-answer', classId: 'class-99', sourceFilename: 'verified-leak.txt' },
    ] }));
    const leakRes = await queryScope(cfg, 'student', leaking);
    assert.strictEqual(leakRes.ok, false);
    assert.match(leakRes.detail, /subjectId=otra-materia/);
});

test('queryScope: network error fails with a clear message', async () => {
    const cfg = baseCfg();
    const fetchImpl = stubFetch(async () => { throw new Error('ECONNRESET'); });
    const res = await queryScope(cfg, 'student', fetchImpl);
    assert.strictEqual(res.ok, false);
    assert.match(res.detail, /ECONNRESET/);
});

test('queryScope: non-JSON 200 body fails', async () => {
    const cfg = baseCfg();
    const fetchImpl = stubFetch(async () => new Response('<html>error</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    const res = await queryScope(cfg, 'student', fetchImpl);
    assert.strictEqual(res.ok, false);
    assert.match(res.detail, /non-JSON/);
});

test('queryScope: per-role subjectId override is sent in the request payload', async () => {
    const cfg = baseCfg({ roles: { ...baseCfg().roles, student: { role: 'student', email: 's@example.com', subjectId: 'sub-override', classIds: ['class-01'], question: 'q custom' } } });
    let seenPayload;
    const fetchImpl = stubFetch(async (url, init) => {
        seenPayload = JSON.parse(init.body);
        return jsonResponse(200, { sources: [{ subjectId: 'sub-override', classIds: ['class-01'] }] });
    });
    const res = await queryScope(cfg, 'student', fetchImpl);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(seenPayload.subjectId, 'sub-override');
    assert.strictEqual(seenPayload.question, 'q custom');
});

test('runCanary: missing frontDoorId fails closed without hitting the network', async () => {
    const cfg = baseCfg({ frontDoorId: '' });
    const fetchImpl = stubFetch(async () => { throw new Error('should not be called'); });
    const outcome = await runCanary(cfg, { fetchImpl });
    assert.ok(outcome.results.find((r) => r.name === 'canary-config').ok === false);
    assert.strictEqual(outcome.failedCount, 5); // 1 config + 4 roles skipped
    assert.ok(outcome.results.every((r) => r.ok !== true), 'no role may pass when config is invalid');
});

test('runCanary: whitespace-only role email fails closed', async () => {
    const cfg = baseCfg();
    cfg.roles.admin.email = '   ';
    const fetchImpl = stubFetch(async () => jsonResponse(200, { sources: [{ subjectId: SUBJECT, classIds: ['class-01'] }] }));
    const outcome = await runCanary(cfg, { fetchImpl });
    assert.ok(outcome.results.find((r) => r.name === 'rag-admin').ok === false);
});

test('runCanary: role config missing entirely fails closed', async () => {
    const cfg = baseCfg();
    cfg.roles.admin = undefined;
    const fetchImpl = stubFetch(async () => jsonResponse(200, { sources: [{ subjectId: SUBJECT, classIds: ['class-01'] }] }));
    const outcome = await runCanary(cfg, { fetchImpl });
    assert.ok(outcome.results.find((r) => r.name === 'rag-admin').ok === false);
});

test('readConfig: RAG_CANARY_ENABLED accepts case-insensitive true and 1', () => {
    const prev = { ...process.env };
    try {
        for (const key of Object.keys(process.env)) {
            if (key.startsWith('RAG_CANARY_')) delete process.env[key];
        }
        process.env.RAG_CANARY_ENABLED = 'TRUE';
        assert.strictEqual(readConfig().enabled, true);
        process.env.RAG_CANARY_ENABLED = '1';
        assert.strictEqual(readConfig().enabled, true);
        process.env.RAG_CANARY_ENABLED = 'false';
        assert.strictEqual(readConfig().enabled, false);
    } finally {
        Object.assign(process.env, prev);
    }
});

test('readConfig: per-role overrides and comma-separated classIds', () => {
    const prev = { ...process.env };
    try {
        for (const key of Object.keys(process.env)) {
            if (key.startsWith('RAG_CANARY_')) delete process.env[key];
        }
        process.env.RAG_CANARY_SUBJECT_ID = 'sub-1';
        process.env.RAG_CANARY_CLASS_IDS = 'class-01, class-02';
        process.env.RAG_CANARY_ADMIN_SUBJECT_ID = 'sub-admin';
        process.env.RAG_CANARY_ADMIN_CLASS_IDS = 'class-09';
        const cfg = readConfig();
        assert.deepStrictEqual(cfg.classIds, ['class-01', 'class-02']);
        assert.strictEqual(cfg.roles.student.subjectId, 'sub-1');
        assert.deepStrictEqual(cfg.roles.student.classIds, ['class-01', 'class-02']);
        assert.strictEqual(cfg.roles.admin.subjectId, 'sub-admin');
        assert.deepStrictEqual(cfg.roles.admin.classIds, ['class-09']);
    } finally {
        Object.assign(process.env, prev);
    }
});

test('queryScope: multi-class requested scope accepts any intersecting class', async () => {
    const cfg = baseCfg({ roles: { ...baseCfg().roles, student: { role: 'student', email: 's@example.com', subjectId: SUBJECT, classIds: ['class-01', 'class-02'], question: 'q' } } });
    const passing = stubFetch(async () => jsonResponse(200, { sources: [
        { subjectId: SUBJECT, classIds: ['class-02'], sourceFilename: 'c02.txt' },
        { subjectId: SUBJECT, classIds: ['class-01', 'class-03'], sourceFilename: 'c01c03.txt' },
    ] }));
    const res = await queryScope(cfg, 'student', passing);
    assert.strictEqual(res.ok, true);

    const failing = stubFetch(async () => jsonResponse(200, { sources: [
        { subjectId: SUBJECT, classIds: ['class-03'], sourceFilename: 'c03.txt' },
    ] }));
    const failRes = await queryScope(cfg, 'student', failing);
    assert.strictEqual(failRes.ok, false);
});

test('runCanary: disabled (RAG_CANARY_ENABLED=false) skips without hitting the network', async () => {
    const cfg = baseCfg({ enabled: false });
    const fetchImpl = stubFetch(async () => { throw new Error('should not be called'); });
    const outcome = await runCanary(cfg, { fetchImpl });
    assert.strictEqual(outcome.failedCount, 0);
    assert.strictEqual(outcome.skippedCount, 1);
    assert.strictEqual(outcome.results[0].name, 'canary');
});

test('runCanary: missing role email fails closed (AC #3 — every configured role needs a scope)', async () => {
    const cfg = baseCfg();
    cfg.roles.admin.email = '';
    const fetchImpl = stubFetch(async () => jsonResponse(200, { sources: [{ subjectId: SUBJECT, classIds: ['class-01'] }] }));
    const outcome = await runCanary(cfg, { fetchImpl });
    assert.ok(outcome.results.find((r) => r.name === 'rag-admin').ok === false);
    assert.match(outcome.results.find((r) => r.name === 'rag-admin').detail, /fail closed/);
    assert.strictEqual(outcome.failedCount, 1);
    assert.strictEqual(outcome.results.filter((r) => r.ok === true).length, 3);
});

test('runCanary: missing function URL fails closed when enabled', async () => {
    const cfg = baseCfg({ functionUrl: '' });
    const outcome = await runCanary(cfg, { fetchImpl: stubFetch(async () => jsonResponse(200, { sources: [] })) });
    assert.ok(outcome.results.find((r) => r.name === 'canary-config').ok === false);
    assert.strictEqual(outcome.failedCount > 0, true);
});

test('runCanary: full pass when every role is in scope', async () => {
    const cfg = baseCfg();
    const fetchImpl = stubFetch(async () => jsonResponse(200, { sources: [{ subjectId: SUBJECT, classIds: ['class-01'], sourceFilename: 'ok.txt' }] }));
    const outcome = await runCanary(cfg, { fetchImpl });
    assert.strictEqual(outcome.failedCount, 0);
    assert.strictEqual(outcome.results.filter((r) => r.ok === true).length, 4);
});

test('assertSourceInScope: subjectId is always required even for bibliography and verified-answer', () => {
    assert.strictEqual(assertSourceInScope({ subjectId: SUBJECT, materialType: 'bibliography' }, SUBJECT, ['class-01']).ok, true);
    assert.strictEqual(assertSourceInScope({ materialType: 'bibliography' }, SUBJECT, ['class-01']).ok, false);
    assert.strictEqual(assertSourceInScope({ subjectId: SUBJECT, materialType: 'verified-answer' }, SUBJECT, ['class-01']).ok, true);
    assert.strictEqual(assertSourceInScope({ materialType: 'verified-answer' }, SUBJECT, ['class-01']).ok, false);
});

test('assertSourceInScope: scope "all" is subject-only', () => {
    assert.strictEqual(assertSourceInScope({ subjectId: SUBJECT, classIds: ['class-99'] }, SUBJECT, ['all']).ok, true);
});

test('sourceClassSet: merges classIds array and canonical classId without duplicates', () => {
    assert.deepStrictEqual(sourceClassSet({ classIds: ['c1', 'c2'], classId: 'c1' }), ['c1', 'c2']);
    assert.deepStrictEqual(sourceClassSet({ classId: 'c1' }), ['c1']);
    assert.deepStrictEqual(sourceClassSet({}), []);
});

test('readConfig: defaults align with pilot seed data', () => {
    const prev = { ...process.env };
    try {
        for (const key of Object.keys(process.env)) {
            if (key.startsWith('RAG_CANARY_')) delete process.env[key];
        }
        process.env.RAG_CANARY_ENABLED = 'true';
        const cfg = readConfig();
        assert.strictEqual(cfg.enabled, true);
        assert.strictEqual(cfg.subjectId, 'arq-software-2026');
        assert.deepStrictEqual(cfg.classIds, ['class-01']);
        assert.strictEqual(cfg.timeoutMs, 30000);
        assert.strictEqual(cfg.roles.student.email, '');
        assert.deepStrictEqual(cfg.roles.student.classIds, ['class-01']);
    } finally {
        Object.assign(process.env, prev);
    }
});