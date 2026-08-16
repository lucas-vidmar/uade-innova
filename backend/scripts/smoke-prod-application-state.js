/**
 * scripts/smoke-prod-application-state.js — Production smoke probe beyond HTTP 200 (Story 10.20)
 *
 * Asserts REAL application state of the deployed Azure Static Web App (EasyAuth
 * identity endpoint, Microsoft sign-in redirect chain, app shell) instead of a
 * bare HTTP 200. A release that serves only a dead-end/auth-error page fails.
 *
 *  - T2.2 identity endpoint:   GET {SMOKE_SWA_URL}/.auth/me      → 200 + JSON `clientPrincipal`
 *  - T2.3 auth redirect:       GET {SMOKE_SWA_URL}/.auth/login/aad → 3xx chain → login.microsoftonline.com
 *  - T2.4 app shell:           GET {SMOKE_SWA_URL}/              → 200 + `id="app"` + `/src/main.js`
 *  - T2.5 no-dead-end (browser, optional): load root, JS must redirect to login.microsoftonline.com
 *  - T2.6 authenticated marker (browser, optional): after sign-in the DOM must carry
 *        `data-app-state="authenticated"` (T1 marker), proving initAuth() succeeded
 *  - T2.7 fail closed: SMOKE_AUTH_ENABLED=true without identity secrets → exit non-zero
 *  - T2.8 Front Door header on Function calls (x-azure-fdid) when SMOKE_FRONT_DOOR_ID is set
 *  - T2.9 bounded timeouts (SMOKE_TIMEOUT_MS, default 15s) per request; exit 0 only when
 *        every executed check passes; per-check PASS/FAIL/SKIP lines for CI logs
 *
 * Env (never committed — GitHub secrets / workflow env):
 *   SMOKE_SWA_URL            required — e.g. https://<swa-host>.azurestaticapps.net
 *   SMOKE_FUNCTION_URL       optional — e.g. https://func-...azurewebsites.net (for /api/hello)
 *   SMOKE_FRONT_DOOR_ID      optional — Front Door ID for Function calls (T2.8)
 *   SMOKE_AUTH_ENABLED       'true'|'false' (default false) — enables the authenticated-marker check
 *   SMOKE_BROWSER_CHECK      'true'|'false' (default false) — enables the no-dead-end browser check
 *   SMOKE_TEST_EMAIL         optional — smoke identity email (Story 10-25 provisioning)
 *   SMOKE_TEST_CLIENT_ID     optional — smoke identity client id (if using client-credential login)
 *   SMOKE_TEST_CLIENT_SECRET optional — smoke identity secret
 *   SMOKE_TIMEOUT_MS         default 15000
 *   SMOKE_PLAYWRIGHT_PATH    optional — explicit path to playwright entry (for browser checks)
 *
 * Run (from repo root after `npm ci` in frontend for browser checks):
 *   SMOKE_SWA_URL=https://<swa>.azurestaticapps.net node backend/scripts/smoke-prod-application-state.js
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_TIMEOUT_MS = 15000;
const MICROSOFT_SIGNIN_HOST = 'login.microsoftonline.com';
const MAX_REDIRECT_HOPS = 6;
const APP_STATE_MARKER = 'authenticated';

function env(name, dflt = '') {
    const v = process.env[name];
    return v === undefined || v === null || v === '' ? dflt : v;
}

export function readConfig() {
    return {
        swaUrl: env('SMOKE_SWA_URL').replace(/\/+$/, ''),
        functionUrl: env('SMOKE_FUNCTION_URL').replace(/\/+$/, ''),
        frontDoorId: env('SMOKE_FRONT_DOOR_ID'),
        authEnabled: env('SMOKE_AUTH_ENABLED') === 'true',
        browserCheck: env('SMOKE_BROWSER_CHECK') === 'true',
        testEmail: env('SMOKE_TEST_EMAIL'),
        testClientId: env('SMOKE_TEST_CLIENT_ID'),
        testClientSecret: env('SMOKE_TEST_CLIENT_SECRET'),
        timeoutMs: Number(env('SMOKE_TIMEOUT_MS', String(DEFAULT_TIMEOUT_MS))) || DEFAULT_TIMEOUT_MS,
        playwrightPath: env('SMOKE_PLAYWRIGHT_PATH'),
    };
}

export function ok(name, detail) {
    return { name, ok: true, detail };
}

export function fail(name, detail) {
    return { name, ok: false, detail };
}

export function skip(name, detail) {
    return { name, ok: null, detail: `SKIP ${detail}` };
}

export function withTimeout(fetchImpl, url, init, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetchImpl(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/** T2.2 — SWA EasyAuth identity endpoint. */
export async function checkIdentityEndpoint(cfg, fetchImpl = fetch) {
    const url = `${cfg.swaUrl}/.auth/me`;
    let res;
    try {
        res = await withTimeout(fetchImpl, url, { method: 'GET', headers: { accept: 'application/json' } }, cfg.timeoutMs);
    } catch (err) {
        return fail('identity-endpoint', `/.auth/me unreachable: ${err.message}`);
    }
    if (res.status !== 200) {
        return fail('identity-endpoint', `/.auth/me returned HTTP ${res.status} (expected 200)`);
    }
    let body;
    try {
        body = await res.text();
    } catch (err) {
        return fail('identity-endpoint', `/.auth/me body unreadable: ${err.message}`);
    }
    let parsed;
    try {
        parsed = JSON.parse(body);
    } catch {
        return fail('identity-endpoint', '/.auth/me did not return valid JSON (EasyAuth stripped?)');
    }
    if (!Object.prototype.hasOwnProperty.call(parsed, 'clientPrincipal')) {
        return fail('identity-endpoint', '/.auth/me JSON has no clientPrincipal key');
    }
    return ok('identity-endpoint', '/.auth/me OK (EasyAuth JSON shape)');
}

/** T2.3 — Microsoft sign-in redirect endpoint is live (chain reaches login.microsoftonline.com). */
export async function checkAuthRedirect(cfg, fetchImpl = fetch) {
    const startUrl = `${cfg.swaUrl}/.auth/login/aad`;
    let current = startUrl;
    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
        let res;
        try {
            res = await withTimeout(fetchImpl, current, { method: 'GET', redirect: 'manual' }, cfg.timeoutMs);
        } catch (err) {
            return fail('auth-redirect', `/.auth/login/aad unreachable at hop ${hop}: ${err.message}`);
        }
        if (res.status >= 300 && res.status < 400) {
            const location = res.headers.get('location');
            if (!location) {
                return fail('auth-redirect', `/.auth/login/aad returned ${res.status} without Location at hop ${hop}`);
            }
            const next = new URL(location, current);
            if (next.hostname === MICROSOFT_SIGNIN_HOST || location.includes(MICROSOFT_SIGNIN_HOST)) {
                return ok('auth-redirect', `/.auth/login/aad redirect chain reaches ${MICROSOFT_SIGNIN_HOST} (${hop + 1} hop(s))`);
            }
            current = next.href;
            continue;
        }
        return fail('auth-redirect', `/.auth/login/aad chain ended with HTTP ${res.status} at hop ${hop} (expected 3xx → ${MICROSOFT_SIGNIN_HOST})`);
    }
    return fail('auth-redirect', `/.auth/login/aad redirect chain exceeded ${MAX_REDIRECT_HOPS} hops without reaching ${MICROSOFT_SIGNIN_HOST}`);
}

/** T2.4 — SWA root serves the app shell (not a 404 / HTML error page). */
export async function checkAppShell(cfg, fetchImpl = fetch) {
    let res;
    try {
        res = await withTimeout(fetchImpl, cfg.swaUrl, { method: 'GET', redirect: 'follow' }, cfg.timeoutMs);
    } catch (err) {
        return fail('app-shell', `SWA root unreachable: ${err.message}`);
    }
    if (res.status !== 200) {
        return fail('app-shell', `SWA root returned HTTP ${res.status} (expected 200)`);
    }
    let html;
    try {
        html = await res.text();
    } catch (err) {
        return fail('app-shell', `SWA root body unreadable: ${err.message}`);
    }
    if (!html.includes('id="app"')) {
        return fail('app-shell', 'SWA root HTML is missing id="app" (app shell not served)');
    }
    // The bundle entry is `/src/main.js` in dev/raw deployments and a hashed
    // `/assets/*.js` in Vite-built production deployments. Either proves a real
    // app bundle entry is served, not a 404 / HTML error page.
    if (!html.includes('/src/main.js') && !/\/assets\/[^"']+\.js/.test(html)) {
        return fail('app-shell', 'SWA root HTML has no JS bundle entry (/src/main.js or /assets/*.js)');
    }
    return ok('app-shell', 'SWA root serves the app shell (id="app" + JS bundle entry)');
}

/** T2.8 — Optional Function health check with Front Door header. */
export async function checkFunctionHealth(cfg, fetchImpl = fetch) {
    if (!cfg.functionUrl) {
        return skip('function-health', '(no SMOKE_FUNCTION_URL configured)');
    }
    const headers = { accept: 'application/json' };
    if (cfg.frontDoorId) {
        headers['x-azure-fdid'] = cfg.frontDoorId;
    }
    let res;
    try {
        res = await withTimeout(fetchImpl, `${cfg.functionUrl}/api/hello`, { method: 'GET', headers }, cfg.timeoutMs);
    } catch (err) {
        return fail('function-health', `/api/hello unreachable: ${err.message}`);
    }
    if (res.status !== 200 && res.status !== 401 && res.status !== 403) {
        return fail('function-health', `/api/hello returned HTTP ${res.status} (expected 200, or 401/403 when auth-gated per #218)`);
    }
    return ok('function-health', `/api/hello OK (HTTP ${res.status})`);
}

/** Pure marker predicate — shared by the browser check and the unit tests (T5.2). */
export function markerStateMatches(appState) {
    return appState === APP_STATE_MARKER;
}

/**
 * Loads Playwright for the optional browser checks. Tries, in order:
 *   1. SMOKE_PLAYWRIGHT_PATH (explicit)
 *   2. bare `import('playwright')` (backend devDep or workspace resolution)
 *   3. `frontend/node_modules/playwright` relative to cwd or its parent (repo layout)
 * Returns the playwright module or null.
 */
export async function loadPlaywright(cfg) {
    const candidates = [];
    if (cfg.playwrightPath) {
        candidates.push(pathToFileURL(path.resolve(cfg.playwrightPath)).href);
    }
    candidates.push('playwright');
    for (const base of [process.cwd(), path.resolve(process.cwd(), '..'), path.resolve(process.cwd(), '..', '..')]) {
        candidates.push(pathToFileURL(path.join(base, 'frontend', 'node_modules', 'playwright', 'index.mjs')).href);
    }
    for (const candidate of candidates) {
        try {
            return await import(candidate);
        } catch {
            // try next candidate
        }
    }
    return null;
}

/** T2.5 — Browser no-dead-end: loading the root must end up at Microsoft sign-in. */
export async function checkNoDeadEndBrowser(cfg, playwright) {
    let browser;
    try {
        browser = await playwright.chromium.launch({ headless: true });
    } catch (err) {
        return fail('no-dead-end-browser', `chromium launch failed: ${err.message}`);
    }
    try {
        const page = await browser.newPage();
        await page.goto(cfg.swaUrl, { waitUntil: 'domcontentloaded', timeout: cfg.timeoutMs });
        try {
            await page.waitForURL((u) => u.hostname === MICROSOFT_SIGNIN_HOST, { timeout: cfg.timeoutMs });
        } catch {
            // fall through to evaluate the actual URL below
        }
        const finalUrl = page.url();
        if (new URL(finalUrl).hostname === MICROSOFT_SIGNIN_HOST) {
            return ok('no-dead-end-browser', `Browser redirected to ${MICROSOFT_SIGNIN_HOST} (no dead-end)`);
        }
        return fail('no-dead-end-browser', `Browser did not reach ${MICROSOFT_SIGNIN_HOST}; final URL: ${finalUrl}`);
    } catch (err) {
        return fail('no-dead-end-browser', `Browser check failed: ${err.message}`);
    } finally {
        await browser.close().catch(() => {});
    }
}

/**
 * T2.6 — Authenticated application-state marker.
 * Uses the smoke identity to drive the AAD sign-in flow and then asserts the
 * T1 marker (`data-app-state="authenticated"` on <html>) is present.
 * Fails closed (T2.7) when SMOKE_AUTH_ENABLED=true but identity secrets are absent.
 */
export async function checkAuthenticatedMarker(cfg, playwright) {
    if (!cfg.authEnabled) {
        return skip('authenticated-marker', '(SMOKE_AUTH_ENABLED=false)');
    }
    const missing = [];
    if (!cfg.testEmail) missing.push('SMOKE_TEST_EMAIL');
    if (!cfg.testClientId && !cfg.testClientSecret) missing.push('SMOKE_TEST_CLIENT_ID/SMOKE_TEST_CLIENT_SECRET');
    if (missing.length > 0) {
        return fail('authenticated-marker', `SMOKE_AUTH_ENABLED=true but missing identity secrets: ${missing.join(', ')} (fail closed)`);
    }

    let browser;
    try {
        browser = await playwright.chromium.launch({ headless: true });
    } catch (err) {
        return fail('authenticated-marker', `chromium launch failed: ${err.message}`);
    }
    try {
        const page = await browser.newPage();
        const returnUrl = encodeURIComponent(`${cfg.swaUrl}/#/student/dashboard`);
        await page.goto(`${cfg.swaUrl}/.auth/login/aad?post_login_redirect_uri=${returnUrl}`, { waitUntil: 'domcontentloaded', timeout: cfg.timeoutMs });

        // Microsoft login form: email → password → stay signed in
        await page.waitForSelector('input[type="email"]', { timeout: cfg.timeoutMs });
        await page.fill('input[type="email"]', cfg.testEmail);
        await page.click('#idSIButton9');
        await page.waitForSelector('input[type="password"]', { timeout: cfg.timeoutMs });
        await page.fill('input[type="password"]', cfg.testClientSecret || cfg.testClientId);
        await page.click('#idSIButton9');
        try {
            await page.waitForSelector('#idSIButton9', { timeout: 5000 });
            await page.click('#idSIButton9');
        } catch {
            // "Stay signed in?" prompt may not appear (e.g. MFA enforced) — the
            // post-login redirect already progressed; treat as non-fatal.
        }

        await page.waitForURL((u) => u.hostname === new URL(cfg.swaUrl).hostname, { timeout: cfg.timeoutMs * 2 });
        await page.waitForSelector('html[data-app-state="authenticated"], #app-boot-marker[data-app-state="authenticated"]', { timeout: cfg.timeoutMs });
        const state = await page.evaluate(() => document.documentElement.dataset.appState || null);
        if (markerStateMatches(state)) {
            return ok('authenticated-marker', 'T1 app-state marker present (data-app-state="authenticated") after initAuth()');
        }
        return fail('authenticated-marker', `T1 app-state marker missing after sign-in (data-app-state=${state ?? 'none'})`);
    } catch (err) {
        return fail('authenticated-marker', `Authenticated marker check failed: ${err.message}`);
    } finally {
        await browser.close().catch(() => {});
    }
}

/** Orchestrates every check; returns { results, failedCount, skippedCount }. */
export async function runProbe(cfg, deps = {}) {
    const fetchImpl = deps.fetchImpl || fetch;
    const results = [];
    results.push(await checkIdentityEndpoint(cfg, fetchImpl));
    results.push(await checkAuthRedirect(cfg, fetchImpl));
    results.push(await checkAppShell(cfg, fetchImpl));
    results.push(await checkFunctionHealth(cfg, fetchImpl));

    const wantsBrowser = cfg.authEnabled || cfg.browserCheck;
    const playwright = wantsBrowser ? await loadPlaywright(cfg) : null;
    if (wantsBrowser && !playwright) {
        results.push(fail('browser-runtime', 'Playwright required (SMOKE_AUTH_ENABLED/SMOKE_BROWSER_CHECK) but could not be loaded — install frontend deps (npm ci) or set SMOKE_PLAYWRIGHT_PATH'));
    } else if (playwright) {
        results.push(await checkNoDeadEndBrowser(cfg, playwright));
        results.push(await checkAuthenticatedMarker(cfg, playwright));
    } else {
        results.push(skip('no-dead-end-browser', `(playwright not loaded; SMOKE_BROWSER_CHECK=${cfg.browserCheck})`));
        results.push(skip('authenticated-marker', `(playwright not loaded; SMOKE_AUTH_ENABLED=${cfg.authEnabled})`));
    }

    const failedCount = results.filter((r) => r.ok === false).length;
    const skippedCount = results.filter((r) => r.ok === null).length;
    return { results, failedCount, skippedCount };
}

function renderResults({ results, failedCount, skippedCount }) {
    for (const r of results) {
        const status = r.ok === true ? 'PASS' : r.ok === false ? 'FAIL' : 'SKIP';
        console.log(`[${status}] ${r.name}: ${r.detail}`);
    }
    const passedCount = results.length - failedCount - skippedCount;
    console.log(`Smoke probe: ${passedCount} PASS, ${failedCount} FAIL, ${skippedCount} SKIP`);
    if (failedCount > 0) {
        console.error(`::error::Smoke probe failed: ${failedCount} check(s) failed — release blocked`);
    }
}

async function main() {
    const cfg = readConfig();
    if (!cfg.swaUrl) {
        console.error('::error::SMOKE_SWA_URL is required (e.g. https://<swa-host>.azurestaticapps.net)');
        process.exit(1);
    }
    const outcome = await runProbe(cfg);
    renderResults(outcome);
    if (outcome.failedCount > 0) {
        process.exit(1);
    }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
    main().catch((err) => {
        console.error('::error::Smoke probe crashed:', err);
        process.exit(1);
    });
}

// Exports kept at the end so importing this module (tests) does not run the probe.
export default { readConfig, runProbe, checkIdentityEndpoint, checkAuthRedirect, checkAppShell, checkFunctionHealth, markerStateMatches };