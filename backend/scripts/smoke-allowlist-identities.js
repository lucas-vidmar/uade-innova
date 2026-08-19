/**
 * scripts/smoke-allowlist-identities.js — Production per-role identity smoke probe (Story 10.25 + 1.7)
 *
 * Asserts one seeded identity per configured role (student, teacher, director,
 * admin) resolves through the central Users + Enrollments tables and the
 * session-token flow to its expected frontend role + scope. Each identity logs
 * in with email+password (POST /api/auth/login → opaque session token) and then
 * GET /api/get-profile is authorized with `Authorization: Bearer <token>`.
 *
 * Two assertion layers:
 *
 *  1. HTTP layer (always, when enabled) — the deploy-time gate:
 *       - login succeeds → token issued (AC: identity authenticates against Users)
 *       - GET /api/get-profile (Bearer) → HTTP 200 + body.role === expected
 *         frontend role + Enrollments-resolved scope (AC1)
 *       - unlisted identity → HTTP 403 + body.code === 'ACCESS_DENIED' (AC3)
 *     plus `x-azure-fdid` when SMOKE_FRONT_DOOR_ID is set.
 *
 *  2. Browser layer (optional, SMOKE_BROWSER_CHECK=true) — signs in per-role
 *     and asserts the app reaches `#/{role}/dashboard` with the authenticated
 *     app-state marker and the dashboard's page marker; for the unlisted
 *     identity it asserts `#/access-denied` renders with `Reintentar` +
 *     `Cerrar sesión` controls. Mirrors the Story 10.20 sign-in flow.
 *
 * Fails closed: SMOKE_ALLOWLIST_ENABLED=true without the per-role identity
 * secrets (emails for the HTTP layer; passwords when browser checks are
 * enabled) → exit non-zero. When disabled, every check prints SKIP and the
 * probe exits 0.
 *
 * Env (never committed — GitHub secrets / workflow env):
 *   SMOKE_ALLOWLIST_ENABLED   'true'|'false' (default false) — master gate
 *   SMOKE_FUNCTION_URL        required when enabled — e.g. https://func-....azurewebsites.net
 *   SMOKE_SWA_URL             required for browser layer — e.g. https://<swa>.azurestaticapps.net
 *   SMOKE_FRONT_DOOR_ID       optional — Front Door id for the x-azure-fdid header
 *   SMOKE_BROWSER_CHECK       'true'|'false' (default false) — enables browser checks
 *   SMOKE_STUDENT_EMAIL       allowlist email of the student smoke identity
 *   SMOKE_STUDENT_PASSWORD    password for browser sign-in (student)
 *   SMOKE_TEACHER_EMAIL       allowlist email of the teacher smoke identity
 *   SMOKE_TEACHER_PASSWORD    password for browser sign-in (teacher)
 *   SMOKE_DIRECTOR_EMAIL      allowlist email of the director smoke identity
 *   SMOKE_DIRECTOR_PASSWORD   password for browser sign-in (director)
 *   SMOKE_ADMIN_EMAIL         allowlist email of the admin smoke identity
 *   SMOKE_ADMIN_PASSWORD      password for browser sign-in (admin)
 *   SMOKE_UNLISTED_EMAIL      unlisted (but authenticatable) identity email
 *   SMOKE_UNLISTED_PASSWORD   password for browser sign-in (unlisted)
 *   SMOKE_TIMEOUT_MS          default 15000
 *   SMOKE_PLAYWRIGHT_PATH     optional explicit path to the playwright entry
 *
 * Run (from repo root):
 *   SMOKE_ALLOWLIST_ENABLED=true SMOKE_FUNCTION_URL=https://func-... \
 *     SMOKE_STUDENT_EMAIL=... node backend/scripts/smoke-allowlist-identities.js
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_TIMEOUT_MS = 15000;
const MICROSOFT_SIGNIN_HOST = 'login.microsoftonline.com';
const APP_STATE_MARKER = 'authenticated';

// Role → mapped dashboard (T1.4). Mirrors frontend/src/main.js ROUTES registry.
export const ROLE_TO_DASHBOARD = Object.freeze({
    student: '#/student/dashboard',
    teacher: '#/teacher/dashboard',
    director: '#/director/dashboard',
    admin: '#/admin/dashboard',
});

// Role → frontend role the allowlist entry must resolve to (frontend role map,
// allowlist.js:31-41 + get-profile.js:65). The allowlist role IS the lowercase
// frontend role for every configured role.
export const ROLE_TO_FRONTEND_ROLE = Object.freeze({
    student: 'student',
    teacher: 'teacher',
    director: 'director',
    admin: 'admin',
});

// Role → DOM page marker rendered by the dashboard (T1.4). These exist in the
// initial render of each dashboard so the browser check can assert "reached its
// mapped dashboard" beyond the bare hash.
export const ROLE_TO_DOM_MARKER = Object.freeze({
    student: '#global-search-header',
    teacher: '.section-title h2',
    director: '#kpi-export-bar',
    admin: 'h1',
});

const ROLE_NAMES = Object.keys(ROLE_TO_DASHBOARD);

function env(name, dflt = '') {
    const v = process.env[name];
    return v === undefined || v === null || v === '' ? dflt : v;
}

export function readConfig() {
    const roles = {};
    for (const role of ROLE_NAMES) {
        const upper = role.toUpperCase();
        roles[role] = {
            email: env(`SMOKE_${upper}_EMAIL`),
            password: env(`SMOKE_${upper}_PASSWORD`),
        };
    }
    return {
        enabled: env('SMOKE_ALLOWLIST_ENABLED') === 'true',
        functionUrl: env('SMOKE_FUNCTION_URL').replace(/\/+$/, ''),
        swaUrl: env('SMOKE_SWA_URL').replace(/\/+$/, ''),
        frontDoorId: env('SMOKE_FRONT_DOOR_ID'),
        browserCheck: env('SMOKE_BROWSER_CHECK') === 'true',
        timeoutMs: Number(env('SMOKE_TIMEOUT_MS', String(DEFAULT_TIMEOUT_MS))) || DEFAULT_TIMEOUT_MS,
        playwrightPath: env('SMOKE_PLAYWRIGHT_PATH'),
        roles,
        unlisted: {
            email: env('SMOKE_UNLISTED_EMAIL'),
            password: env('SMOKE_UNLISTED_PASSWORD'),
        },
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

function profileHeaders(cfg, token) {
    const headers = { accept: 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (cfg.frontDoorId) headers['x-azure-fdid'] = cfg.frontDoorId;
    return headers;
}

/**
 * Authenticates an email+password identity against the central Users table via
 * POST /api/auth/login (Story 1.1a/1.7) and returns the opaque session token.
 * Resolves through the new session model (sessions-store.js) instead of the
 * retired `x-ms-client-principal-name` allowlist header.
 */
export async function loginSession(cfg, identity, fetchImpl = fetch) {
    const url = `${cfg.functionUrl}/api/auth/login`;
    let res;
    try {
        res = await withTimeout(fetchImpl, url, {
            method: 'POST',
            headers: { accept: 'application/json', 'content-type': 'application/json' },
            body: JSON.stringify({ email: identity.email, password: identity.password || '' }),
        }, cfg.timeoutMs);
    } catch (err) {
        return { error: `${url} unreachable: ${err.message}` };
    }
    if (res.status !== 200) {
        return { error: `${url} returned HTTP ${res.status} for ${identity.email} (expected 200 login)` };
    }
    let body;
    try {
        body = await res.json();
    } catch (err) {
        return { error: `${url} body unreadable: ${err.message}` };
    }
    if (!body || !body.token) {
        return { error: `${url} did not return a session token (body.token missing)` };
    }
    return { token: body.token };
}

/**
 * HTTP — allowlisted role identity resolves through the server-side Users table
 * to its expected frontend role and scope (AC1). Identity is authenticated with
 * email+password (login → session token) and then GET /api/get-profile is
 * authorized with `Authorization: Bearer <token>`.
 */
export async function checkAllowlistedRole(cfg, role, identity, fetchImpl = fetch) {
    const name = `allowlist-${role}`;
    if (!cfg.functionUrl) {
        return fail(name, 'SMOKE_FUNCTION_URL required when SMOKE_ALLOWLIST_ENABLED=true (fail closed)');
    }
    const login = await loginSession(cfg, identity, fetchImpl);
    if (login.error) return fail(name, login.error);
    const url = `${cfg.functionUrl}/api/get-profile`;
    const headers = profileHeaders(cfg, login.token);
    let res;
    try {
        res = await withTimeout(fetchImpl, url, { method: 'GET', headers }, cfg.timeoutMs);
    } catch (err) {
        return fail(name, `${url} unreachable: ${err.message}`);
    }
    if (res.status !== 200) {
        return fail(name, `${url} returned HTTP ${res.status} (expected 200; session resolution failed)`);
    }
    let body;
    try {
        body = await res.json();
    } catch (err) {
        return fail(name, `${url} body unreadable: ${err.message}`);
    }
    const expectedRole = ROLE_TO_FRONTEND_ROLE[role];
    if (body.role !== expectedRole) {
        return fail(name, `session resolved role=${body.role}, expected ${expectedRole}`);
    }
    if (!body.scope || !Array.isArray(body.scope.subjects)) {
        return fail(name, `session-resolved scope missing for role=${role} (email=${identity.email})`);
    }
    const dashboard = ROLE_TO_DASHBOARD[role];
    return ok(name, `role=${body.role} → ${dashboard} (scope subjects: ${body.scope.subjects.join(', ') || 'n/a'})`);
}

/**
 * HTTP — unlisted (but authenticatable) identity is denied by the server-side
 * allowlist (AC3). Asserts 403 + code ACCESS_DENIED (with-auth.js:71-78,
 * auth-utils.js:170-174 fail closed).
 */
export async function checkUnlistedDenied(cfg, identity, fetchImpl = fetch) {
    const name = 'allowlist-unlisted-denied';
    if (!cfg.functionUrl) {
        return fail(name, 'SMOKE_FUNCTION_URL required when SMOKE_ALLOWLIST_ENABLED=true (fail closed)');
    }
    const login = await loginSession(cfg, identity, fetchImpl);
    if (login.error) return fail(name, login.error);
    const url = `${cfg.functionUrl}/api/get-profile`;
    const headers = profileHeaders(cfg, login.token);
    let res;
    try {
        res = await withTimeout(fetchImpl, url, { method: 'GET', headers }, cfg.timeoutMs);
    } catch (err) {
        return fail(name, `${url} unreachable: ${err.message}`);
    }
    if (res.status !== 403) {
        return fail(name, `${url} returned HTTP ${res.status} for unlisted email (expected 403 ACCESS_DENIED)`);
    }
    let body;
    try {
        body = await res.json();
    } catch (err) {
        return fail(name, `${url} body unreadable: ${err.message}`);
    }
    if (body.code !== 'ACCESS_DENIED') {
        return fail(name, `unlisted email denied with body.code=${body.code || '(none)'}, expected ACCESS_DENIED`);
    }
    return ok(name, '403 ACCESS_DENIED (fail closed — no role/dashboard reachable)');
}

/** Pure marker predicate — the browser checks and unit tests share it. */
export function markerStateMatches(appState) {
    return appState === APP_STATE_MARKER;
}

/**
 * Loads Playwright for the optional browser checks (same resolution order as
 * the Story 10.20 probe). Returns the playwright module or null.
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

/** Drives the AAD sign-in flow (shared by the role and unlisted browser checks). */
export async function signInViaAad(cfg, page, email, password, targetHost) {
    const returnUrl = encodeURIComponent(`${cfg.swaUrl}/`);
    await page.goto(`${cfg.swaUrl}/.auth/login/aad?post_login_redirect_uri=${returnUrl}`, {
        waitUntil: 'domcontentloaded',
        timeout: cfg.timeoutMs,
    });
    await page.waitForSelector('input[type="email"]', { timeout: cfg.timeoutMs });
    await page.fill('input[type="email"]', email);
    await page.click('#idSIButton9');
    await page.waitForSelector('input[type="password"]', { timeout: cfg.timeoutMs });
    await page.fill('input[type="password"]', password);
    await page.click('#idSIButton9');
    try {
        await page.waitForSelector('#idSIButton9', { timeout: 5000 });
        await page.click('#idSIButton9');
    } catch {
        // "Stay signed in?" prompt may not appear (e.g. MFA enforced) — non-fatal.
    }
    await page.waitForURL((u) => u.hostname === targetHost, { timeout: cfg.timeoutMs * 2 });
}

/**
 * Browser (optional) — an allowlisted role identity reaches its mapped
 * dashboard: authenticated app-state marker + `#/{role}/dashboard` hash +
 * dashboard DOM page marker (AC1).
 */
export async function checkRoleDashboardBrowser(cfg, role, playwright) {
    const name = `dashboard-${role}`;
    if (!cfg.swaUrl) {
        return fail(name, 'SMOKE_SWA_URL required for browser checks (fail closed)');
    }
    const identity = cfg.roles[role];
    if (!identity || !identity.email || !identity.password) {
        return fail(name, `SMOKE_${role.toUpperCase()}_EMAIL/PASSWORD required for browser check (fail closed)`);
    }
    let browser;
    try {
        browser = await playwright.chromium.launch({ headless: true });
    } catch (err) {
        return fail(name, `chromium launch failed: ${err.message}`);
    }
    try {
        const page = await browser.newPage();
        await signInViaAad(cfg, page, identity.email, identity.password, new URL(cfg.swaUrl).hostname);
        await page.waitForSelector(`html[data-app-state="${APP_STATE_MARKER}"]`, { timeout: cfg.timeoutMs });
        const hash = await page.evaluate(() => window.location.hash || '');
        if (!hash.startsWith(ROLE_TO_DASHBOARD[role])) {
            return fail(name, `landed on ${hash || '(empty hash)'}, expected ${ROLE_TO_DASHBOARD[role]}`);
        }
        const marker = ROLE_TO_DOM_MARKER[role];
        // Dashboards render asynchronously (data fetch after the shell) — wait for
        // the marker to prove the page actually rendered, not just the shell.
        try {
            await page.waitForSelector(marker, { timeout: cfg.timeoutMs });
        } catch {
            return fail(name, `dashboard DOM marker never appeared: ${marker} at ${ROLE_TO_DASHBOARD[role]}`);
        }
        const hasMarker = await page.evaluate((sel) => {
            if (sel === 'h1') {
                return Array.from(document.querySelectorAll('h1')).some((h) => h.textContent.trim().length > 0);
            }
            return Boolean(document.querySelector(sel));
        }, marker);
        if (!hasMarker) {
            return fail(name, `dashboard DOM marker missing: ${marker} at ${ROLE_TO_DASHBOARD[role]}`);
        }
        return ok(name, `${ROLE_TO_DASHBOARD[role]} reached (authenticated marker + ${marker})`);
    } catch (err) {
        return fail(name, `dashboard check failed: ${err.message}`);
    } finally {
        await browser.close().catch(() => {});
    }
}

/**
 * Browser (optional) — an unlisted identity receives the access-denied page
 * with sign-out/retry controls and no dashboard is reachable (AC3).
 */
export async function checkUnlistedDeniedBrowser(cfg, playwright) {
    const name = 'access-denied-browser';
    if (!cfg.swaUrl) {
        return fail(name, 'SMOKE_SWA_URL required for browser checks (fail closed)');
    }
    if (!cfg.unlisted || !cfg.unlisted.email || !cfg.unlisted.password) {
        return fail(name, 'SMOKE_UNLISTED_EMAIL/PASSWORD required for browser check (fail closed)');
    }
    let browser;
    try {
        browser = await playwright.chromium.launch({ headless: true });
    } catch (err) {
        return fail(name, `chromium launch failed: ${err.message}`);
    }
    try {
        const page = await browser.newPage();
        await signInViaAad(cfg, page, cfg.unlisted.email, cfg.unlisted.password, new URL(cfg.swaUrl).hostname);
        await page.waitForSelector('#access-denied-logout, .empty-state-icon', { timeout: cfg.timeoutMs });
        const state = await page.evaluate(() => ({
            hash: window.location.hash || '',
            text: document.body.innerText || '',
            logout: Boolean(document.getElementById('access-denied-logout')),
        }));
        const isAccessDeniedPage = state.hash.startsWith('#/access-denied') || state.text.includes('Acceso denegado');
        if (!isAccessDeniedPage) {
            return fail(name, `unlisted identity did not land on access-denied; hash=${state.hash || '(empty)'}`);
        }
        const hasRetry = state.text.includes('Reintentar');
        const hasLogout = state.logout && state.text.includes('Cerrar sesión');
        if (!hasRetry || !hasLogout) {
            return fail(name, `access-denied page missing controls (Reintentar=${hasRetry}, Cerrar sesión=${hasLogout})`);
        }
        return ok(name, 'access-denied page rendered with Reintentar + Cerrar sesión (no dashboard reachable)');
    } catch (err) {
        return fail(name, `unlisted browser check failed: ${err.message}`);
    } finally {
        await browser.close().catch(() => {});
    }
}

/** Orchestrates every check; returns { results, failedCount, skippedCount }. */
export async function runProbe(cfg, deps = {}) {
    const fetchImpl = deps.fetchImpl || fetch;
    const results = [];

    if (!cfg.enabled) {
        for (const role of ROLE_NAMES) {
            results.push(skip(`allowlist-${role}`, '(SMOKE_ALLOWLIST_ENABLED=false)'));
            results.push(skip(`dashboard-${role}`, '(SMOKE_ALLOWLIST_ENABLED=false)'));
        }
        results.push(skip('allowlist-unlisted-denied', '(SMOKE_ALLOWLIST_ENABLED=false)'));
        results.push(skip('access-denied-browser', '(SMOKE_ALLOWLIST_ENABLED=false)'));
        return summarize(results);
    }

    // HTTP layer — fail closed on missing per-role emails/passwords.
    for (const role of ROLE_NAMES) {
        const identity = cfg.roles[role];
        if (!identity || !identity.email) {
            results.push(fail(`allowlist-${role}`, `SMOKE_${role.toUpperCase()}_EMAIL missing (fail closed)`));
        } else if (!identity.password) {
            results.push(fail(`allowlist-${role}`, `SMOKE_${role.toUpperCase()}_PASSWORD missing (fail closed)`));
        } else {
            results.push(await checkAllowlistedRole(cfg, role, identity, fetchImpl));
        }
    }
    if (!cfg.unlisted || !cfg.unlisted.email || !cfg.unlisted.password) {
        results.push(fail('allowlist-unlisted-denied', 'SMOKE_UNLISTED_EMAIL/PASSWORD missing (fail closed)'));
    } else {
        results.push(await checkUnlistedDenied(cfg, cfg.unlisted, fetchImpl));
    }

    // Browser layer — optional (SMOKE_BROWSER_CHECK=true) but fails closed on
    // missing password secrets once enabled.
    if (cfg.browserCheck) {
        const playwright = await loadPlaywright(cfg);
        if (!playwright) {
            results.push(fail('browser-runtime', 'SMOKE_BROWSER_CHECK=true but Playwright could not be loaded — install frontend deps (npm ci) or set SMOKE_PLAYWRIGHT_PATH'));
        } else {
            for (const role of ROLE_NAMES) {
                results.push(await checkRoleDashboardBrowser(cfg, role, playwright));
            }
            results.push(await checkUnlistedDeniedBrowser(cfg, playwright));
        }
    } else {
        for (const role of ROLE_NAMES) {
            results.push(skip(`dashboard-${role}`, '(SMOKE_BROWSER_CHECK=false)'));
        }
        results.push(skip('access-denied-browser', '(SMOKE_BROWSER_CHECK=false)'));
    }

    return summarize(results);
}

function summarize(results) {
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
    console.log(`Allowlist smoke probe: ${passedCount} PASS, ${failedCount} FAIL, ${skippedCount} SKIP`);
    if (failedCount > 0) {
        console.error('::error::Allowlist smoke probe failed: at least one role identity did not resolve/reach its dashboard, or the unlisted identity was not denied — release blocked');
    }
}

async function main() {
    const cfg = readConfig();
    if (!cfg.enabled) {
        console.log('SMOKE_ALLOWLIST_ENABLED is not true — per-role allowlist smoke probe skipped.');
        return;
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
        console.error('::error::Allowlist smoke probe crashed:', err);
        process.exit(1);
    });
}

// Exports kept at the end so importing this module (tests) does not run the probe.
export default {
    readConfig,
    runProbe,
    checkAllowlistedRole,
    checkUnlistedDenied,
    checkRoleDashboardBrowser,
    checkUnlistedDeniedBrowser,
    markerStateMatches,
    ROLE_TO_DASHBOARD,
    ROLE_TO_FRONTEND_ROLE,
    ROLE_TO_DOM_MARKER,
};