/**
 * services/allowlist.js — Server-side identity allowlist (Story 1.1a)
 *
 * Maps verified Microsoft-account emails to application roles and subject/class
 * scope. The allowlist lives ONLY in a deploy-managed Functions app setting
 * (`ALLOWED_USERS_JSON`, backed by a Key Vault reference). It is never exposed
 * to the browser and never a `VITE_*` variable; changes require a deployment.
 *
 * Fail-closed rules:
 *  - Emails are matched trimmed + case-insensitive.
 *  - Missing, unverified, duplicated, or conflicting entries deny access.
 *  - Role and scope come from here and only from here.
 *
 * Expected env value (JSON array):
 *   [{"email":"prof@uade.edu.ar","role":"teacher","subjects":["arq-software-2026"]}]
 *
 * Roles: student | teacher | director | admin
 */

const VALID_ROLES = ['student', 'teacher', 'director', 'admin'];

// Lowercase allowlist role -> internal (Spanish) role used by backend role checks.
const INTERNAL_ROLE_BY_ROLE = {
  student: 'Alumno',
  teacher: 'Docente',
  director: 'Director',
  admin: 'Admin',
};

// Internal role -> lowercase role used by the frontend profile payload.
export const FRONTEND_ROLE_BY_INTERNAL = {
  Alumno: 'student',
  Docente: 'teacher',
  Director: 'director',
  Admin: 'admin',
};

// Claim types that may carry the verified email, most specific first.
const EMAIL_CLAIM_TYPES = [
  'emails',
  'email',
  'emailaddress',
  'upn',
  'preferred_username',
  'unique_name',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  'http://schemas.microsoft.com/identity/claims/email',
  'name',
];

function firstEmailValue(value) {
  if (Array.isArray(value)) {
    return value.find((v) => typeof v === 'string' && v.includes('@')) || null;
  }
  return typeof value === 'string' && value.includes('@') ? value : null;
}

/**
 * Extracts the best verified-email candidate from a principal object, honoring
 * claims (SWA array or OIDC payload object) before userDetails. Returns the raw
 * email (not normalized); null when absent.
 * @param {Object|null} principal
 * @returns {string|null}
 */
export function extractVerifiedEmail(principal) {
  if (!principal) return null;

  const direct = firstEmailValue(principal.email);
  if (direct) return direct;

  const claims = principal.claims;
  if (Array.isArray(claims)) {
    for (const claim of claims) {
      const typ = claim?.typ;
      const val = claim?.val;
      if (typ && EMAIL_CLAIM_TYPES.includes(typ)) {
        const found = firstEmailValue(val);
        if (found) return found;
      }
    }
  } else if (claims && typeof claims === 'object') {
    for (const typ of EMAIL_CLAIM_TYPES) {
      if (typ in claims) {
        const found = firstEmailValue(claims[typ]);
        if (found) return found;
      }
    }
  }

  return firstEmailValue(principal.userDetails);
}

/**
 * Resolves the identity email for a principal+request. Trusted sources win:
 *   1. Verified claims / userDetails from the principal (SWA x-ms-client-principal,
 *      validated OIDC Bearer).
 *   2. `x-ms-client-principal-name` header — the client-relayed identity from the
 *      SWA `/.auth/me` endpoint. This is the PILOT direct-cross-origin transport
 *      (see spec Design Notes, Ask First). It is IGNORED whenever a trusted
 *      principal email is available and MUST be replaced by the SWA `/api` proxy
 *      (Standard tier) or OIDC bearer plumbing (#194) for tamper-proof transport.
 * @param {Object|null} principal
 * @param {Request} request
 * @returns {string|null}
 */
export function resolvePrincipalEmail(principal, request) {
  const verified = extractVerifiedEmail(principal);
  if (verified) return verified;

  const relayed = request?.headers?.get?.('x-ms-client-principal-name');
  if (relayed && typeof relayed === 'string' && relayed.includes('@')) {
    return relayed.trim();
  }
  return null;
}

let _cache = null;

/**
 * Normalizes an email for allowlist comparison (trim + lowercase).
 * @param {string} email
 * @returns {string}
 */
export function normalizeEmail(email) {
  return String(email == null ? '' : email).trim().toLowerCase();
}

function rawConfig() {
  const raw = process.env.ALLOWED_USERS_JSON || '';
  // Unresolved Key Vault references stay literal and must not enable the
  // allowlist (mirrors the ENTRA_* placeholders posture).
  if (raw.includes('@Microsoft.KeyVault')) return '';
  return raw;
}

/**
 * True when a deploy-managed allowlist is configured. When unconfigured the
 * legacy role-from-principal behavior is preserved (e.g. local Development).
 * @returns {boolean}
 */
export function isAllowlistConfigured() {
  return rawConfig().trim().length > 0;
}

function parseConfig() {
  const raw = rawConfig().trim();
  if (!raw) return { entries: new Map(), invalidEmails: [] };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(`[Allowlist] Configuración inválida (JSON no parseable): ${err.message}. La allowlist se considera vacía (fail closed).`);
    return { entries: new Map(), invalidEmails: [] };
  }

  if (!Array.isArray(parsed)) {
    console.warn('[Allowlist] Configuración inválida: se esperaba un array JSON de entradas. La allowlist se considera vacía (fail closed).');
    return { entries: new Map(), invalidEmails: [] };
  }

  const entries = new Map();
  const invalidEmails = [];
  const seen = new Map(); // normalizedEmail -> first index

  const invalidate = (email, index, reason) => {
    invalidEmails.push(email);
    console.warn(`[Allowlist] Entrada inválida (fail closed): email="${email}" index=${index} reason=${reason}`);
    entries.set(email, null);
  };

  parsed.forEach((rawEntry, index) => {
    if (!rawEntry || typeof rawEntry !== 'object') {
      console.warn(`[Allowlist] Entrada inválida (fail closed): index=${index} reason=no_es_objeto`);
      return;
    }
    const email = normalizeEmail(rawEntry.email);
    const role = String(rawEntry.role || '').trim().toLowerCase();
    const subjects = Array.isArray(rawEntry.subjects) ? rawEntry.subjects.map(String) : [];
    const classes = Array.isArray(rawEntry.classes) ? rawEntry.classes.map(String) : [];

    if (!email || !email.includes('@')) {
      invalidate(email || '(vacío)', index, 'email_ausente_o_invalido');
      return;
    }

    if (!VALID_ROLES.includes(role)) {
      invalidate(email, index, `rol_invalido_${role || '(vacío)'}`);
      return;
    }

    if (seen.has(email)) {
      invalidate(email, index, `email_duplicado_primer_uso_index=${seen.get(email)}`);
      return;
    }
    seen.set(email, index);

    entries.set(email, {
      email,
      role,
      internalRole: INTERNAL_ROLE_BY_ROLE[role],
      subjects,
      classes,
      index,
    });
  });

  return { entries, invalidEmails };
}

function getCache() {
  if (!_cache) {
    _cache = parseConfig();
    if (_cache.entries.size > 0 || _cache.invalidEmails.length > 0) {
      console.warn(`[Allowlist] Cargadas ${_cache.entries.size} entradas válidas y ${_cache.invalidEmails.length} inválidas (fail closed).`);
    }
  }
  return _cache;
}

/**
 * Test hook: clears the memoized allowlist so env changes take effect.
 */
export function resetAllowlistCache() {
  _cache = null;
}

/**
 * Resolves the allowlist entry for an email, or null when unlisted/invalid.
 * @param {string} email
 * @returns {Object|null} { email, role, internalRole, subjects, classes }
 */
export function resolveEntryForEmail(email) {
  if (!isAllowlistConfigured()) return null;
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return getCache().entries.get(normalized) || null;
}

/**
 * Resolves the internal role ('Alumno'|'Docente'|'Director'|'Admin') for an
 * email, or null when unlisted/invalid.
 * @param {string} email
 * @returns {string|null}
 */
export function resolveRoleForEmail(email) {
  const entry = resolveEntryForEmail(email);
  return entry ? entry.internalRole : null;
}

/**
 * Resolves subject/class scope for an email, or null when unlisted/invalid.
 * @param {string} email
 * @returns {{subjects: string[], classes: string[]}|null}
 */
export function resolveScopeForEmail(email) {
  const entry = resolveEntryForEmail(email);
  if (!entry) return null;
  return { subjects: entry.subjects, classes: entry.classes };
}

/**
 * Maps an internal role to the lowercase role used by the frontend profile.
 * @param {string} internalRole
 * @returns {string|undefined}
 */
export function toFrontendRole(internalRole) {
  return FRONTEND_ROLE_BY_INTERNAL[internalRole];
}

/**
 * Diagnostic snapshot (tests / debugging). Never exposed to the browser.
 * @returns {{configured: boolean, entryCount: number, invalidEmails: string[]}}
 */
export function getAllowlistDiagnostics() {
  const cache = getCache();
  return {
    configured: isAllowlistConfigured(),
    entryCount: cache.entries.size,
    invalidEmails: [...cache.invalidEmails],
  };
}
