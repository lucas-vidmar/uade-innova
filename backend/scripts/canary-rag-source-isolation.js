/**
 * scripts/canary-rag-source-isolation.js — Production RAG source-isolation canary (Story 3.7 / #261)
 *
 * Standalone HTTPS probe that asserts every source returned by the deployed
 * POST /api/rag-query belongs to the requested subjectId/classIds scope. A
 * source mismatch — or an unverifiable empty sources[] — exits non-zero so the
 * release smoke gate blocks the deploy (AC #1/#2; the defect is QA-002 in
 * docs/qa-browser-report-2026-08-14.md:90-115).
 *
 * Identity: each configured role (student, teacher, director, admin) sends its
 * own allowlisted email via `x-ms-client-principal-name` (the pilot direct
 * cross-origin transport honored by allowlist.js:110-114) paired with
 * `x-azure-fdid` (Front Door validation, auth-utils.js:212-224). Blocking mode
 * (stream:false) keeps the probe SSE-free.
 *
 * Gating: RAG queries only run when RAG_CANARY_ENABLED=true (the CI step gates
 * on that env so the canary stays off until allowlist identities are
 * provisioned). Once enabled, every configured role must carry an allowlisted
 * email — a missing one fails closed (AC #3).
 *
 * Bibliography + verified-answer: the Pinecone filter has a bibliography
 * fallback clause (`$or: [{classId:{$eq}},{materialType: bibliography}]`,
 * rag-query.js buildPineconeFilter) and the verified-answer pre-search is
 * subject-only (rag-query.js verifiedFilter), so those sources may legitimately
 * belong to any class of the subject. The canary ALWAYS asserts subjectId and
 * only asserts classId for other (non-bibliography, non-verified-answer)
 * sources.
 *
 * Env (never committed — GitHub secrets / workflow env):
 *   RAG_CANARY_ENABLED           'true'|'false' (default false) — master switch
 *   RAG_CANARY_FUNCTION_URL      required when enabled, e.g. https://func-...azurewebsites.net
 *   RAG_CANARY_FRONT_DOOR_ID     required when enabled — Front Door ID (x-azure-fdid)
 *   RAG_CANARY_SUBJECT_ID        default arq-software-2026
 *   RAG_CANARY_CLASS_IDS         default class-01 (comma-separated)
 *   RAG_CANARY_QUESTION          default '¿Qué es la arquitectura de software?'
 *   RAG_CANARY_TIMEOUT_MS        default 30000
 *   RAG_CANARY_STUDENT_EMAIL     allowlisted student identity
 *   RAG_CANARY_TEACHER_EMAIL     allowlisted teacher identity
 *   RAG_CANARY_DIRECTOR_EMAIL    allowlisted director identity
 *   RAG_CANARY_ADMIN_EMAIL       allowlisted admin identity
 *   RAG_CANARY_<ROLE>_SUBJECT_ID / _CLASS_IDS / _QUESTION
 *       optional per-role scope/question overrides (default to the shared ones)
 *   RAG_CANARY_EXTRA_SUBJECT_IDS
 *       optional comma-separated extra pilot subjects to probe per-subject
 *       (#328, e.g. 'diseno-sistemas-2026') with the student identity.
 *       Per-subject overrides: RAG_CANARY_EXTRA_<SUBJECT>_CLASS_IDS /
 *       RAG_CANARY_EXTRA_<SUBJECT>_QUESTION (<SUBJECT> uppercased, non
 *       alphanumerics as '_').
 *
 * Run (repo root):
 *   RAG_CANARY_ENABLED=true \
 *   RAG_CANARY_FUNCTION_URL=https://func-dashboard-ingest-<token>.azurewebsites.net \
 *   RAG_CANARY_FRONT_DOOR_ID=<fd-id> \
 *   RAG_CANARY_STUDENT_EMAIL=<email> RAG_CANARY_TEACHER_EMAIL=<email> \
 *   RAG_CANARY_DIRECTOR_EMAIL=<email> RAG_CANARY_ADMIN_EMAIL=<email> \
 *   node backend/scripts/canary-rag-source-isolation.js
 */
import { pathToFileURL } from 'node:url';

const ROLES = ['student', 'teacher', 'director', 'admin'];
const DEFAULT_SUBJECT_ID = 'arq-software-2026';
const DEFAULT_CLASS_IDS = 'class-01';
const DEFAULT_QUESTION = '¿Qué es la arquitectura de software?';
const DEFAULT_TIMEOUT_MS = 30000;
// Auth/rate-limit responses that mean "the scope is blocked, not verified".
const HARD_FAIL_STATUSES = [401, 403, 429];

function env(name, dflt = '') {
    const v = process.env[name];
    return v === undefined || v === null || v === '' ? dflt : v;
}

function parseClassIds(raw) {
    return String(raw || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

export function readConfig() {
    const subjectId = env('RAG_CANARY_SUBJECT_ID', DEFAULT_SUBJECT_ID);
    const classIds = parseClassIds(env('RAG_CANARY_CLASS_IDS', DEFAULT_CLASS_IDS));
    const question = env('RAG_CANARY_QUESTION', DEFAULT_QUESTION);

    const roles = {};
    for (const role of ROLES) {
        const upper = role.toUpperCase();
        roles[role] = {
            role,
            email: env(`RAG_CANARY_${upper}_EMAIL`),
            subjectId: env(`RAG_CANARY_${upper}_SUBJECT_ID`, subjectId),
            classIds: parseClassIds(env(`RAG_CANARY_${upper}_CLASS_IDS`, env('RAG_CANARY_CLASS_IDS', DEFAULT_CLASS_IDS))),
            question: env(`RAG_CANARY_${upper}_QUESTION`, question),
        };
    }

    // #328: per-subject extension — extra pilot subjects to probe with the
    // student identity (comma-separated). Each extra subject runs the same
    // source-isolation assertion, so a mislabeled vector (ej: DASI docx with
    // a pilot subjectId, or class-01 content served to a class-02 query) fails
    // the gate no matter which subject it leaks into.
    // Per-subject scope overrides: RAG_CANARY_EXTRA_<SUBJECT>_CLASS_IDS /
    // RAG_CANARY_EXTRA_<SUBJECT>_QUESTION, where <SUBJECT> is the subjectId
    // uppercased with non-alphanumerics replaced by '_'.
    const extraSubjects = parseClassIds(env('RAG_CANARY_EXTRA_SUBJECT_IDS', '')).map((extraSubjectId) => {
        const key = extraSubjectId.toUpperCase().replace(/[^A-Z0-9]/g, '_');
        return {
            subjectId: extraSubjectId,
            classIds: parseClassIds(env(`RAG_CANARY_EXTRA_${key}_CLASS_IDS`, env('RAG_CANARY_CLASS_IDS', DEFAULT_CLASS_IDS))),
            question: env(`RAG_CANARY_EXTRA_${key}_QUESTION`, question),
        };
    });

    return {
        // Accept case-insensitive 'true'/'1'; anything else non-empty is NOT
        // enabled (matches CI semantics where an unset secret means "off"),
        // but never treat 'TRUE'/'1' as off — an isolation gate must not
        // silently disable.
        enabled: ['true', '1'].includes(env('RAG_CANARY_ENABLED').trim().toLowerCase()),
        functionUrl: env('RAG_CANARY_FUNCTION_URL').replace(/\/+$/, ''),
        frontDoorId: env('RAG_CANARY_FRONT_DOOR_ID'),
        timeoutMs: Number(env('RAG_CANARY_TIMEOUT_MS', String(DEFAULT_TIMEOUT_MS))) || DEFAULT_TIMEOUT_MS,
        subjectId,
        classIds,
        roles,
        extraSubjects,
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

/** Reads the response body with the same bounded timeout (a stalled body must not hang the gate). */
async function readBodyWithTimeout(res, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await res.text();
    } finally {
        clearTimeout(timer);
    }
}

/**
 * The set of classes a returned source claims. Accepts the payload `classId`
 * (canonical, rag-query.js) and/or the `classIds` array (normalized by
 * vector-store.js normalizeMetadata).
 */
export function sourceClassSet(source) {
    const out = [];
    if (Array.isArray(source?.classIds)) out.push(...source.classIds);
    if (typeof source?.classId === 'string' && source.classId) out.push(source.classId);
    return [...new Set(out)];
}

/**
 * Asserts a single source is within the requested scope.
 * subjectId is ALWAYS asserted; classId is asserted only for sources whose
 * type is neither `bibliography` (filter has a class fallback by design) nor
 * `verified-answer` (pre-search filter is subject-only), and a requested scope
 * containing 'all' is subject-only.
 * @returns {{ok: boolean, reason?: string}}
 */
export function assertSourceInScope(source, expectedSubjectId, expectedClassIds) {
    if (!source || typeof source !== 'object') {
        return { ok: false, reason: 'source object is missing' };
    }
    if (source.subjectId !== expectedSubjectId) {
        return { ok: false, reason: `subjectId=${source.subjectId ?? '(missing)'} (expected ${expectedSubjectId})` };
    }
    const classExempt = source.materialType === 'bibliography' || source.materialType === 'verified-answer' || expectedClassIds.includes('all');
    if (classExempt) {
        return { ok: true };
    }
    const classes = sourceClassSet(source);
    if (classes.length === 0) {
        return { ok: false, reason: 'no classId/classIds in source payload (isolation unverifiable)' };
    }
    if (!classes.some((c) => expectedClassIds.includes(c))) {
        return { ok: false, reason: `classId=[${classes.join(',')}] does not intersect requested [${expectedClassIds.join(',')}]` };
    }
    return { ok: true };
}

/**
 * Runs one per-role scoped RAG query against the deployed Function and asserts
 * every returned source. 401/403/429 are hard failures (auth/rate-limit blocked
 * the scope — the canary must not silently skip). Empty sources[] fails as
 * "isolation unverifiable".
 */
export async function queryScope(cfg, role, fetchImpl = fetch) {
    const roleCfg = cfg.roles[role];
    return querySubjectScope(cfg, {
        label: `rag-${role}`,
        email: roleCfg?.email,
        subjectId: roleCfg?.subjectId,
        classIds: roleCfg?.classIds,
        question: roleCfg?.question,
    }, fetchImpl);
}

/**
 * Core scoped-query probe (#328): POSTs one blocking RAG query for an explicit
 * (subjectId, classIds) scope with the given identity email and asserts every
 * returned source belongs to that scope. Shared by the per-role checks and the
 * per-subject extension probes.
 */
export async function querySubjectScope(cfg, { label, email, subjectId, classIds, question }, fetchImpl = fetch) {
    const url = `${cfg.functionUrl}/api/rag-query`;
    const payload = {
        question,
        subjectId,
        classIds,
        stream: false,
    };
    const headers = {
        'Content-Type': 'application/json',
        'x-azure-fdid': cfg.frontDoorId,
        'x-ms-client-principal-name': email,
    };

    let res;
    try {
        res = await withTimeout(fetchImpl, url, { method: 'POST', headers, body: JSON.stringify(payload) }, cfg.timeoutMs);
    } catch (err) {
        return fail(label, `request failed: ${err.message}`);
    }

    if (HARD_FAIL_STATUSES.includes(res.status)) {
        return fail(label, `HTTP ${res.status} — hard failure (auth/rate-limit blocks the scope)`);
    }
    if (res.status !== 200) {
        let detail = `HTTP ${res.status}`;
        try {
            const text = await readBodyWithTimeout(res, cfg.timeoutMs);
            if (text) detail += ` — ${text.slice(0, 300)}`;
        } catch { /* body unreadable — keep status only */ }
        return fail(label, detail);
    }

    let body;
    try {
        const text = await readBodyWithTimeout(res, cfg.timeoutMs);
        body = JSON.parse(text);
    } catch (err) {
        return fail(label, `non-JSON/aborted body: ${err.message}`);
    }

    const sources = Array.isArray(body?.sources) ? body.sources : null;
    if (!sources || sources.length === 0) {
        return fail(label, 'sources[] is empty — isolation unverifiable (0 sources returned)');
    }

    const violations = [];
    for (const source of sources) {
        const verdict = assertSourceInScope(source, subjectId, classIds);
        if (!verdict.ok) {
            violations.push(`"${source?.sourceFilename ?? source?.materialId ?? '(unknown)'}": ${verdict.reason}`);
        }
    }
    if (violations.length > 0) {
        return fail(label, violations.join(' | '));
    }
    return ok(label, `${sources.length} source(s) — all match subjectId=${subjectId} and classIds=[${(classIds || []).join(',')}]`);
}

/**
 * Orchestrates every configured role. Returns { results, failedCount, skippedCount }.
 * Fail closed (AC #3): when enabled, each role must carry an allowlisted email
 * and a non-empty scope; missing ones are reported as failures, not skipped.
 */
export async function runCanary(cfg, deps = {}) {
    const fetchImpl = deps.fetchImpl || fetch;
    const results = [];

    if (!cfg.enabled) {
        results.push(skip('canary', '(RAG_CANARY_ENABLED=false — canary off until allowlist identities are provisioned)'));
        return { results, failedCount: 0, skippedCount: 1 };
    }

    let configValid = true;
    if (!cfg.functionUrl) {
        results.push(fail('canary-config', 'RAG_CANARY_FUNCTION_URL is required when RAG_CANARY_ENABLED=true (fail closed)'));
        configValid = false;
    }
    if (!cfg.frontDoorId) {
        results.push(fail('canary-config', 'RAG_CANARY_FRONT_DOOR_ID is required when RAG_CANARY_ENABLED=true (Front Door validation, fail closed)'));
        configValid = false;
    }

    for (const role of ROLES) {
        const roleCfg = cfg.roles[role];
        const label = `rag-${role}`;
        if (!roleCfg) {
            results.push(fail(label, `role config missing for ${role} — fail closed`));
            continue;
        }
        if (!roleCfg.email || !roleCfg.email.trim()) {
            results.push(fail(label, `missing RAG_CANARY_${role.toUpperCase()}_EMAIL — fail closed (AC #3: every configured role needs a scope identity)`));
            continue;
        }
        if (!roleCfg.subjectId || roleCfg.classIds.length === 0) {
            results.push(fail(label, `missing scope (subjectId/classIds) for role ${role} — fail closed`));
            continue;
        }
        // Config errors already fail the gate; skip queries against an empty URL.
        if (!configValid) {
            results.push(fail(label, 'skipped — canary config invalid (RAG_CANARY_FUNCTION_URL / RAG_CANARY_FRONT_DOOR_ID)'));
            continue;
        }
        results.push(await queryScope(cfg, role, fetchImpl));
    }

    // #328: per-subject extension probes — one blocking query per extra pilot
    // subject with the student identity. Fail closed on missing identity/scope.
    for (const extra of cfg.extraSubjects || []) {
        const label = `rag-cross-${extra.subjectId}`;
        const studentEmail = cfg.roles?.student?.email;
        if (!studentEmail || !studentEmail.trim()) {
            results.push(fail(label, 'missing student email for cross-subject probe — fail closed'));
            continue;
        }
        if (!extra.subjectId || !Array.isArray(extra.classIds) || extra.classIds.length === 0) {
            results.push(fail(label, `missing scope for extra subject ${extra.subjectId} — fail closed`));
            continue;
        }
        if (!configValid) {
            results.push(fail(label, 'skipped — canary config invalid (RAG_CANARY_FUNCTION_URL / RAG_CANARY_FRONT_DOOR_ID)'));
            continue;
        }
        results.push(await querySubjectScope(cfg, {
            label,
            email: studentEmail,
            subjectId: extra.subjectId,
            classIds: extra.classIds,
            question: extra.question,
        }, fetchImpl));
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
    console.log(`RAG canary: ${passedCount} PASS, ${failedCount} FAIL, ${skippedCount} SKIP`);
    if (failedCount > 0) {
        console.error(`::error::RAG source-isolation canary failed: ${failedCount} check(s) failed — release blocked`);
    }
}

async function main() {
    const cfg = readConfig();
    const outcome = await runCanary(cfg);
    renderResults(outcome);
    if (outcome.failedCount > 0) {
        process.exit(1);
    }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
    main().catch((err) => {
        console.error('::error::RAG canary crashed:', err);
        process.exit(1);
    });
}

// Exports kept at the end so importing this module (tests) does not run the probe.
export default { readConfig, runCanary, queryScope, querySubjectScope, assertSourceInScope, sourceClassSet, ok, fail, skip };