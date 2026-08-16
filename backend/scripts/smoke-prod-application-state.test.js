import { test } from 'node:test';
import assert from 'node:assert';
import { setupTestEnv } from '../src/test-utils/env.js';

setupTestEnv();

const {
    readConfig, runProbe, checkIdentityEndpoint, checkAuthRedirect,
    checkAppShell, checkFunctionHealth, markerStateMatches,
} = await import('./smoke-prod-application-state.js');

const SWA = 'https://smoke-test.azurestaticapps.net';

function jsonResponse(status, body, extra = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...(extra.headers || {}) },
    });
}

function redirectResponse(location, status = 302) {
    return new Response(null, { status, headers: { location } });
}

function htmlResponse(html, status = 200) {
    return new Response(html, { status, headers: { 'content-type': 'text/html' } });
}

/** Builds a fetch stub routing by pathname. */
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

function baseRoutes(overrides = {}) {
    return {
        '/.auth/me': () => jsonResponse(200, { clientPrincipal: null }),
        '/.auth/login/aad': () => redirectResponse(`https://${'login.microsoftonline.com'}/common/oauth2/v2.0/authorize`),
        '/': () => htmlResponse('<html><body><div id="app"></div><script type="module" src="/src/main.js"></script></body></html>'),
        ...overrides,
    };
}

test('identity endpoint: EasyAuth JSON shape passes', async () => {
    const res = await checkIdentityEndpoint({ swaUrl: SWA, timeoutMs: 5000 }, stubFetch(baseRoutes()));
    assert.strictEqual(res.ok, true);
});

test('identity endpoint: non-200 fails', async () => {
    const res = await checkIdentityEndpoint({ swaUrl: SWA, timeoutMs: 5000 }, stubFetch(baseRoutes({
        '/.auth/me': () => jsonResponse(404, {}),
    })));
    assert.strictEqual(res.ok, false);
    assert.match(res.detail, /404/);
});

test('identity endpoint: 302 (EasyAuth stripped) fails', async () => {
    const res = await checkIdentityEndpoint({ swaUrl: SWA, timeoutMs: 5000 }, stubFetch(baseRoutes({
        '/.auth/me': () => redirectResponse('/login'),
    })));
    assert.strictEqual(res.ok, false);
});

test('identity endpoint: JSON without clientPrincipal fails', async () => {
    const res = await checkIdentityEndpoint({ swaUrl: SWA, timeoutMs: 5000 }, stubFetch(baseRoutes({
        '/.auth/me': () => jsonResponse(200, { nope: true }),
    })));
    assert.strictEqual(res.ok, false);
});

test('auth redirect: Location reaching login.microsoftonline.com passes', async () => {
    const res = await checkAuthRedirect({ swaUrl: SWA, timeoutMs: 5000 }, stubFetch(baseRoutes()));
    assert.strictEqual(res.ok, true);
    assert.match(res.detail, /login\.microsoftonline\.com/);
});

test('auth redirect: multi-hop chain reaching login.microsoftonline.com passes', async () => {
    const routes = {
        '/.auth/login/aad': () => redirectResponse('https://identity.6.azurestaticapps.net/.redirect/aad?hostName=x'),
        '/.redirect/aad': () => redirectResponse('https://identity.6.azurestaticapps.net/.auth/login/aad?post_login_redirect_uri=/'),
        // hop 2 → microsoftonline
        '/.auth/login/aad?post_login_redirect_uri=/': () => redirectResponse('https://login.microsoftonline.com/common/oauth2/v2.0/authorize'),
    };
    const res = await checkAuthRedirect({ swaUrl: SWA, timeoutMs: 5000 }, stubFetch(routes));
    assert.strictEqual(res.ok, true);
});

test('auth redirect: wrong Location fails', async () => {
    const res = await checkAuthRedirect({ swaUrl: SWA, timeoutMs: 5000 }, stubFetch(baseRoutes({
        '/.auth/login/aad': () => redirectResponse('https://evil.example.com/steal'),
    })));
    assert.strictEqual(res.ok, false);
});

test('auth redirect: non-3xx fails', async () => {
    const res = await checkAuthRedirect({ swaUrl: SWA, timeoutMs: 5000 }, stubFetch(baseRoutes({
        '/.auth/login/aad': () => jsonResponse(200, {}),
    })));
    assert.strictEqual(res.ok, false);
});

test('auth redirect: exhausted hops fail', async () => {
    const routes = {
        '/.auth/login/aad': () => redirectResponse('https://loop.example.com/hop'),
        '/hop': () => redirectResponse('https://loop.example.com/hop'),
    };
    const res = await checkAuthRedirect({ swaUrl: SWA, timeoutMs: 5000 }, stubFetch(routes));
    assert.strictEqual(res.ok, false);
    assert.match(res.detail, /exceeded|hops/);
});

test('app shell: HTML with id="app" and /src/main.js passes', async () => {
    const res = await checkAppShell({ swaUrl: SWA, timeoutMs: 5000 }, stubFetch(baseRoutes()));
    assert.strictEqual(res.ok, true);
});

test('app shell: HTML with id="app" and a built /assets/*.js entry passes', async () => {
    const res = await checkAppShell({ swaUrl: SWA, timeoutMs: 5000 }, stubFetch(baseRoutes({
        '/': () => htmlResponse('<html><head></head><body><div id="app"></div><script type="module" src="/assets/index-p5JQzKCE.js"></script></body></html>'),
    })));
    assert.strictEqual(res.ok, true);
});

test('app shell: HTML missing /src/main.js and /assets/*.js fails', async () => {
    const res = await checkAppShell({ swaUrl: SWA, timeoutMs: 5000 }, stubFetch(baseRoutes({
        '/': () => htmlResponse('<html><body><div id="app"></div><p>error page</p></body></html>'),
    })));
    assert.strictEqual(res.ok, false);
    assert.match(res.detail, /bundle entry/);
});

test('app shell: HTML missing id="app" fails', async () => {
    const res = await checkAppShell({ swaUrl: SWA, timeoutMs: 5000 }, stubFetch(baseRoutes({
        '/': () => htmlResponse('<html><body><script src="/src/main.js"></script></body></html>'),
    })));
    assert.strictEqual(res.ok, false);
});

test('app shell: non-200 fails', async () => {
    const res = await checkAppShell({ swaUrl: SWA, timeoutMs: 5000 }, stubFetch(baseRoutes({
        '/': () => htmlResponse('<html><body>error</body></html>', 500),
    })));
    assert.strictEqual(res.ok, false);
});

test('runProbe: full unauthenticated run passes with all HTTP checks', async () => {
    const cfg = { swaUrl: SWA, timeoutMs: 5000, authEnabled: false, browserCheck: false };
    const outcome = await runProbe(cfg, { fetchImpl: stubFetch(baseRoutes()) });
    assert.strictEqual(outcome.failedCount, 0);
    const names = outcome.results.map((r) => r.name);
    assert.ok(names.includes('identity-endpoint'));
    assert.ok(names.includes('auth-redirect'));
    assert.ok(names.includes('app-shell'));
    // No playwright → browser checks SKIP, not FAIL
    assert.ok(outcome.results.filter((r) => r.ok === null).length >= 2);
});

test('runProbe: broken release (SWA root error page) fails the run', async () => {
    const cfg = { swaUrl: SWA, timeoutMs: 5000, authEnabled: false, browserCheck: false };
    const outcome = await runProbe(cfg, { fetchImpl: stubFetch(baseRoutes({
        '/': () => htmlResponse('<html><body>502 Bad Gateway</body></html>', 502),
    })) });
    assert.strictEqual(outcome.failedCount, 1);
    assert.ok(outcome.results.find((r) => r.name === 'app-shell').ok === false);
});

test('runProbe: broken release (auth-redirect dead-end) fails the run', async () => {
    const cfg = { swaUrl: SWA, timeoutMs: 5000, authEnabled: false, browserCheck: false };
    const outcome = await runProbe(cfg, { fetchImpl: stubFetch(baseRoutes({
        '/.auth/login/aad': () => jsonResponse(200, {}),
    })) });
    assert.strictEqual(outcome.failedCount, 1);
    assert.ok(outcome.results.find((r) => r.name === 'auth-redirect').ok === false);
});

test('function-health: skipped without SMOKE_FUNCTION_URL', async () => {
    const cfg = { swaUrl: SWA, timeoutMs: 5000, functionUrl: '' };
    const res = await checkFunctionHealth(cfg, stubFetch(baseRoutes()));
    assert.strictEqual(res.ok, null);
});

test('function-health: 200 passes', async () => {
    const cfg = { swaUrl: SWA, timeoutMs: 5000, functionUrl: 'https://func.example.com' };
    const res = await checkFunctionHealth(cfg, stubFetch({
        '/api/hello': () => new Response('Hello from Azure Functions!', { status: 200 }),
    }));
    assert.strictEqual(res.ok, true);
});

test('function-health: 401/403 (auth-gated per #218) passes', async () => {
    const cfg = { swaUrl: SWA, timeoutMs: 5000, functionUrl: 'https://func.example.com' };
    const res401 = await checkFunctionHealth(cfg, stubFetch({
        '/api/hello': () => jsonResponse(401, { code: 'AUTH_REQUIRED' }),
    }));
    assert.strictEqual(res401.ok, true);
});

test('function-health: 5xx fails', async () => {
    const cfg = { swaUrl: SWA, timeoutMs: 5000, functionUrl: 'https://func.example.com' };
    const res = await checkFunctionHealth(cfg, stubFetch({
        '/api/hello': () => jsonResponse(500, { error: 'boom' }),
    }));
    assert.strictEqual(res.ok, false);
});

test('authenticated-marker: fails closed when SMOKE_AUTH_ENABLED=true without identity secrets', async () => {
    const cfg = { swaUrl: SWA, timeoutMs: 5000, authEnabled: true, browserCheck: false, testEmail: '', testClientId: '', testClientSecret: '' };
    const playwright = { chromium: { launch: async () => { throw new Error('should not launch'); } } };
    const { checkAuthenticatedMarker } = await import('./smoke-prod-application-state.js');
    const res = await checkAuthenticatedMarker(cfg, playwright);
    assert.strictEqual(res.ok, false);
    assert.match(res.detail, /missing identity secrets|fail closed/);
});

test('marker predicate: only "authenticated" matches (T1 marker contract)', () => {
    assert.strictEqual(markerStateMatches('authenticated'), true);
    assert.strictEqual(markerStateMatches(null), false);
    assert.strictEqual(markerStateMatches(undefined), false);
    assert.strictEqual(markerStateMatches('denied'), false);
    assert.strictEqual(markerStateMatches(''), false);
});

test('readConfig: parses env defaults', () => {
    const prev = { ...process.env };
    try {
        process.env.SMOKE_SWA_URL = SWA;
        delete process.env.SMOKE_AUTH_ENABLED;
        const cfg = readConfig();
        assert.strictEqual(cfg.swaUrl, SWA);
        assert.strictEqual(cfg.authEnabled, false);
        assert.strictEqual(cfg.browserCheck, false);
        assert.strictEqual(cfg.timeoutMs, 15000);
    } finally {
        Object.assign(process.env, prev);
    }
});