import { test } from 'node:test';
import assert from 'node:assert';
import { setupTestEnv } from '../src/test-utils/env.js';

setupTestEnv();

const {
    readConfig, runProbe, checkAllowlistedRole, checkUnlistedDenied,
    checkRoleDashboardBrowser, checkUnlistedDeniedBrowser, markerStateMatches,
    ROLE_TO_DASHBOARD, ROLE_TO_FRONTEND_ROLE, ROLE_TO_DOM_MARKER,
} = await import('./smoke-allowlist-identities.js');

const FUNC = 'https://func-smoke.azurewebsites.net';
const SWA = 'https://smoke-test.azurestaticapps.net';

function jsonResponse(status, body, extra = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...(extra.headers || {}) },
    });
}

function stubFetch(routes) {
    return async (url, init = {}) => {
        const u = new URL(String(url));
        const key = `${u.pathname}${u.search}`;
        const handler = routes[key] || routes[String(url)] || routes[u.pathname];
        if (!handler) {
            throw new Error(`Unexpected fetch: ${u.href}`);
        }
        return handler(u, init);
    };
}

const ROLE_EMAILS = {
    student: 'smoke-student@uade.edu.ar',
    teacher: 'smoke-teacher@uade.edu.ar',
    director: 'smoke-director@uade.edu.ar',
    admin: 'smoke-admin@uade.edu.ar',
};
const UNLISTED_EMAIL = 'unlisted@outside.example.com';

function roleRoutes(overrides = {}) {
    const routes = {
        '/api/auth/login': (u, init) => {
            const body = JSON.parse(init.body || '{}');
            // Login always succeeds for the probe (identity exists in Users);
            // authorization/entitlement is asserted at /api/get-profile.
            return jsonResponse(200, { success: true, token: `token-${body.email}` });
        },
        '/api/get-profile': (u, init) => {
            const auth = init.headers?.authorization || init.headers?.get?.('authorization') || '';
            const token = auth.replace(/^Bearer\s+/i, '');
            const email = token.replace(/^token-/, '');
            if (email === UNLISTED_EMAIL) {
                return jsonResponse(403, { error: 'denied', errorCategory: 'AUTH', code: 'ACCESS_DENIED' });
            }
            const role = Object.keys(ROLE_EMAILS).find((r) => ROLE_EMAILS[r] === email);
            return jsonResponse(200, {
                role: role || 'student',
                email,
                scope: { subjects: ['arq-software-2026'], classes: [] },
                consentAccepted: true,
            });
        },
        ...overrides,
    };
    return routes;
}

function enabledCfg(overrides = {}) {
    return {
        enabled: true,
        functionUrl: FUNC,
        swaUrl: SWA,
        frontDoorId: '',
        browserCheck: false,
        timeoutMs: 5000,
        playwrightPath: '',
        roles: {
            student: { email: ROLE_EMAILS.student, password: 'pw-student' },
            teacher: { email: ROLE_EMAILS.teacher, password: 'pw-teacher' },
            director: { email: ROLE_EMAILS.director, password: 'pw-director' },
            admin: { email: ROLE_EMAILS.admin, password: 'pw-admin' },
        },
        unlisted: { email: UNLISTED_EMAIL, password: 'pw-unlisted' },
        ...overrides,
    };
}

test('ROLE_TO_DASHBOARD mirrors the four mapped dashboards (T1)', () => {
    assert.deepEqual(ROLE_TO_DASHBOARD, {
        student: '#/student/dashboard',
        teacher: '#/teacher/dashboard',
        director: '#/director/dashboard',
        admin: '#/admin/dashboard',
    });
});

test('ROLE_TO_FRONTEND_ROLE maps each role to its lowercase frontend role (T1)', () => {
    assert.deepEqual(ROLE_TO_FRONTEND_ROLE, {
        student: 'student',
        teacher: 'teacher',
        director: 'director',
        admin: 'admin',
    });
});

test('ROLE_TO_DOM_MARKER defines a page marker per dashboard (T1.4)', () => {
    for (const role of Object.keys(ROLE_TO_DASHBOARD)) {
        assert.ok(ROLE_TO_DOM_MARKER[role], `marker missing for ${role}`);
    }
});

test('allowlisted role: resolves to its frontend role + scope + mapped dashboard (AC1)', async () => {
    for (const role of Object.keys(ROLE_EMAILS)) {
        const cfg = enabledCfg();
        const res = await checkAllowlistedRole(cfg, role, cfg.roles[role], stubFetch(roleRoutes()));
        assert.strictEqual(res.ok, true, `${role}: ${res.detail}`);
        assert.match(res.detail, new RegExp(`#/${role}/dashboard`));
        assert.match(res.detail, new RegExp(`role=${role}`));
    }
});

test('allowlisted role: resolved role mismatch fails (role guard contract)', async () => {
    const cfg = enabledCfg();
    const res = await checkAllowlistedRole(cfg, 'admin', cfg.roles.admin, stubFetch(roleRoutes({
        '/api/get-profile': () => jsonResponse(200, { role: 'student', email: ROLE_EMAILS.admin, scope: { subjects: ['x'], classes: [] } }),
    })));
    assert.strictEqual(res.ok, false);
    assert.match(res.detail, /expected admin/);
});

test('allowlisted role: non-200 fails', async () => {
    const cfg = enabledCfg();
    const res = await checkAllowlistedRole(cfg, 'student', cfg.roles.student, stubFetch({
        '/api/get-profile': () => jsonResponse(500, { error: 'boom' }),
    }));
    assert.strictEqual(res.ok, false);
});

test('allowlisted role: missing scope fails (allowlist resolution incomplete)', async () => {
    const cfg = enabledCfg();
    const res = await checkAllowlistedRole(cfg, 'student', cfg.roles.student, stubFetch(roleRoutes({
        '/api/get-profile': () => jsonResponse(200, { role: 'student', email: ROLE_EMAILS.student, scope: null }),
    })));
    assert.strictEqual(res.ok, false);
    assert.match(res.detail, /scope missing/);
});

test('allowlisted role: missing SMOKE_FUNCTION_URL fails closed', async () => {
    const cfg = enabledCfg({ functionUrl: '' });
    const res = await checkAllowlistedRole(cfg, 'student', cfg.roles.student, stubFetch(roleRoutes()));
    assert.strictEqual(res.ok, false);
    assert.match(res.detail, /SMOKE_FUNCTION_URL required/);
});

test('unlisted identity: 403 + ACCESS_DENIED passes (AC3, server-side denial)', async () => {
    const cfg = enabledCfg();
    const res = await checkUnlistedDenied(cfg, cfg.unlisted, stubFetch(roleRoutes()));
    assert.strictEqual(res.ok, true);
    assert.match(res.detail, /ACCESS_DENIED/);
});

test('unlisted identity: non-403 fails (allowlist must deny, fail closed)', async () => {
    const cfg = enabledCfg();
    const res = await checkUnlistedDenied(cfg, cfg.unlisted, stubFetch({
        '/api/get-profile': () => jsonResponse(200, { role: 'student' }),
    }));
    assert.strictEqual(res.ok, false);
});

test('unlisted identity: 403 without ACCESS_DENIED code fails', async () => {
    const cfg = enabledCfg();
    const res = await checkUnlistedDenied(cfg, cfg.unlisted, stubFetch(roleRoutes({
        '/api/get-profile': () => jsonResponse(403, { error: 'forbidden', code: 'FORBIDDEN' }),
    })));
    assert.strictEqual(res.ok, false);
    assert.match(res.detail, /ACCESS_DENIED/);
});

test('runProbe: disabled gate SKIPs everything and exits clean', async () => {
    const cfg = enabledCfg({ enabled: false });
    const outcome = await runProbe(cfg, { fetchImpl: stubFetch(roleRoutes()) });
    assert.strictEqual(outcome.failedCount, 0);
    assert.ok(outcome.results.every((r) => r.ok === null));
});

test('runProbe: enabled HTTP layer passes with one identity per role + unlisted denial', async () => {
    const cfg = enabledCfg();
    const outcome = await runProbe(cfg, { fetchImpl: stubFetch(roleRoutes()) });
    assert.strictEqual(outcome.failedCount, 0);
    const names = outcome.results.map((r) => r.name);
    for (const role of Object.keys(ROLE_EMAILS)) {
        assert.ok(names.includes(`allowlist-${role}`));
    }
    assert.ok(names.includes('allowlist-unlisted-denied'));
});

test('runProbe: missing role email fails closed', async () => {
    const cfg = enabledCfg();
    cfg.roles.admin.email = '';
    const outcome = await runProbe(cfg, { fetchImpl: stubFetch(roleRoutes()) });
    assert.strictEqual(outcome.failedCount, 1);
    assert.ok(outcome.results.find((r) => r.name === 'allowlist-admin').ok === false);
    assert.match(outcome.results.find((r) => r.name === 'allowlist-admin').detail, /missing \(fail closed\)/);
});

test('runProbe: missing unlisted email fails closed (AC3 gate)', async () => {
    const cfg = enabledCfg();
    cfg.unlisted.email = '';
    const outcome = await runProbe(cfg, { fetchImpl: stubFetch(roleRoutes()) });
    assert.strictEqual(outcome.failedCount, 1);
    assert.ok(outcome.results.find((r) => r.name === 'allowlist-unlisted-denied').ok === false);
});

test('runProbe: an unlisted identity that is NOT denied fails the gate', async () => {
    const cfg = enabledCfg();
    const outcome = await runProbe(cfg, { fetchImpl: stubFetch(roleRoutes({
        '/api/get-profile': (u, init) => {
            const auth = init.headers?.authorization || init.headers?.get?.('authorization') || '';
            const email = auth.replace(/^Bearer\s+/i, '').replace(/^token-/, '');
            if (email === UNLISTED_EMAIL) {
                // Unlisted identity is NOT denied → must fail.
                return jsonResponse(200, { role: 'student', email: UNLISTED_EMAIL, scope: { subjects: ['x'], classes: [] } });
            }
            const role = Object.keys(ROLE_EMAILS).find((r) => ROLE_EMAILS[r] === email);
            return jsonResponse(200, { role, email, scope: { subjects: ['arq-software-2026'], classes: [] } });
        },
    })) });
    assert.strictEqual(outcome.failedCount, 1);
    assert.ok(outcome.results.find((r) => r.name === 'allowlist-unlisted-denied').ok === false);
});

test('runProbe: browser layer fails closed on missing password secrets when enabled', async () => {
    const cfg = enabledCfg({ browserCheck: true });
    cfg.roles.teacher.password = '';
    const playwright = { chromium: { launch: async () => { throw new Error('should not launch'); } } };
    const { runProbe } = await import('./smoke-allowlist-identities.js');
    // browserCheck=true will try to load Playwright; inject it via deps-less path is
    // impossible here, so instead we assert the per-role browser check fails closed.
    const res = await checkRoleDashboardBrowser(cfg, 'teacher', playwright);
    assert.strictEqual(res.ok, false);
    assert.match(res.detail, /PASSWORD required/);
});

test('runProbe: browser layer fails closed without SMOKE_SWA_URL', async () => {
    const cfg = enabledCfg({ swaUrl: '' });
    const playwright = { chromium: { launch: async () => { throw new Error('should not launch'); } } };
    const res = await checkRoleDashboardBrowser(cfg, 'student', playwright);
    assert.strictEqual(res.ok, false);
    assert.match(res.detail, /SMOKE_SWA_URL required/);
});

test('browser dashboard: allowlisted role reaches mapped dashboard (AC1, fake page)', async () => {
    const cfg = enabledCfg({ browserCheck: true });
    const fakePage = {
        async goto() {},
        async waitForSelector() {},
        async waitForURL() {},
        async fill() {},
        async click() {},
        async evaluate(fn, arg) {
            if (typeof fn === 'function') {
                // No arg => the hash query (returns '#/student/dashboard').
                if (arg === undefined) return '#/student/dashboard';
                // Marker query.
                if (arg === 'h1') return true;
                return Boolean(arg);
            }
            return '#/student/dashboard';
        },
    };
    let closed = false;
    const fakeBrowser = {
        async newPage() { return fakePage; },
        async close() { closed = true; },
    };
    const playwright = { chromium: { launch: async () => fakeBrowser } };
    const res = await checkRoleDashboardBrowser(cfg, 'student', playwright);
    assert.strictEqual(res.ok, true, res.detail);
});

test('browser dashboard: wrong landing hash fails (AC1)', async () => {
    const cfg = enabledCfg({ browserCheck: true });
    const fakePage = {
        async goto() {},
        async waitForSelector() {},
        async waitForURL() {},
        async fill() {},
        async click() {},
        async evaluate(fn, arg) {
            if (arg === undefined) return '#/teacher/dashboard'; // wrong role
            return Boolean(arg);
        },
    };
    const fakeBrowser = {
        async newPage() { return fakePage; },
        async close() {},
    };
    const playwright = { chromium: { launch: async () => fakeBrowser } };
    const res = await checkRoleDashboardBrowser(cfg, 'student', playwright);
    assert.strictEqual(res.ok, false);
    assert.match(res.detail, /expected #\/student\/dashboard/);
});

test('browser unlisted: access-denied page with sign-out/retry passes (AC3)', async () => {
    const cfg = enabledCfg({ browserCheck: true });
    const fakePage = {
        async goto() {},
        async waitForSelector() {},
        async waitForURL() {},
        async fill() {},
        async click() {},
        async evaluate(fn, arg) {
            return {
                hash: '#/access-denied',
                text: 'Acceso denegado ... Reintentar Cerrar sesión',
                logout: true,
            };
        },
    };
    const fakeBrowser = {
        async newPage() { return fakePage; },
        async close() {},
    };
    const playwright = { chromium: { launch: async () => fakeBrowser } };
    const res = await checkUnlistedDeniedBrowser(cfg, playwright);
    assert.strictEqual(res.ok, true, res.detail);
});

test('browser unlisted: access-denied page missing logout control fails (AC3)', async () => {
    const cfg = enabledCfg({ browserCheck: true });
    const fakePage = {
        async goto() {},
        async waitForSelector() {},
        async waitForURL() {},
        async fill() {},
        async click() {},
        async evaluate() {
            return { hash: '#/access-denied', text: 'Acceso denegado Reintentar', logout: false };
        },
    };
    const fakeBrowser = {
        async newPage() { return fakePage; },
        async close() {},
    };
    const playwright = { chromium: { launch: async () => fakeBrowser } };
    const res = await checkUnlistedDeniedBrowser(cfg, playwright);
    assert.strictEqual(res.ok, false);
    assert.match(res.detail, /Cerrar sesión/);
});

test('browser unlisted: landing on a dashboard instead of access-denied fails (AC3)', async () => {
    const cfg = enabledCfg({ browserCheck: true });
    const fakePage = {
        async goto() {},
        async waitForSelector() {},
        async waitForURL() {},
        async fill() {},
        async click() {},
        async evaluate() {
            return { hash: '#/student/dashboard', text: 'Inicio', logout: false };
        },
    };
    const fakeBrowser = {
        async newPage() { return fakePage; },
        async close() {},
    };
    const playwright = { chromium: { launch: async () => fakeBrowser } };
    const res = await checkUnlistedDeniedBrowser(cfg, playwright);
    assert.strictEqual(res.ok, false);
    assert.match(res.detail, /did not land on access-denied/);
});

test('marker predicate: only "authenticated" matches', () => {
    assert.strictEqual(markerStateMatches('authenticated'), true);
    assert.strictEqual(markerStateMatches('denied'), false);
    assert.strictEqual(markerStateMatches(null), false);
});

test('readConfig: parses per-role env (fail-closed surface)', () => {
    const prev = { ...process.env };
    try {
        delete process.env.SMOKE_ALLOWLIST_ENABLED;
        delete process.env.SMOKE_STUDENT_EMAIL;
        delete process.env.SMOKE_UNLISTED_EMAIL;
        process.env.SMOKE_STUDENT_EMAIL = ROLE_EMAILS.student;
        process.env.SMOKE_UNLISTED_EMAIL = UNLISTED_EMAIL;
        const cfg = readConfig();
        assert.strictEqual(cfg.enabled, false);
        assert.strictEqual(cfg.roles.student.email, ROLE_EMAILS.student);
        assert.strictEqual(cfg.roles.teacher.email, '');
        assert.strictEqual(cfg.unlisted.email, UNLISTED_EMAIL);
    } finally {
        Object.assign(process.env, prev);
    }
});