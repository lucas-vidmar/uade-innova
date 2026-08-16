import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const {
  normalizeEmail,
  isAllowlistConfigured,
  resetAllowlistCache,
  resolveEntryForEmail,
  resolveRoleForEmail,
  resolveScopeForEmail,
  resolveUserIdForEmail,
  toFrontendRole,
  getAllowlistDiagnostics,
  extractVerifiedEmail,
  resolvePrincipalEmail,
} = await import('./allowlist.js');

const savedEnv = { ...process.env };

beforeEach(() => {
  process.env.ALLOWED_USERS_JSON = '';
  resetAllowlistCache();
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in savedEnv)) delete process.env[k];
  }
  Object.assign(process.env, savedEnv);
  resetAllowlistCache();
});

test('NOT_CONFIGURED — empty env => not configured, resolves deny', () => {
  assert.equal(isAllowlistConfigured(), false);
  assert.equal(resolveEntryForEmail('prof@uade.edu.ar'), null);
  assert.equal(resolveRoleForEmail('prof@uade.edu.ar'), null);
  assert.equal(resolveScopeForEmail('prof@uade.edu.ar'), null);
});

test('UNRESOLVED_KV_REF — literal @Microsoft.KeyVault reference treated as not configured', () => {
  process.env.ALLOWED_USERS_JSON = '@Microsoft.KeyVault(SecretUri=https://kv/secrets/ALLOWED-USERS-JSON/)';
  resetAllowlistCache();
  assert.equal(isAllowlistConfigured(), false);
  assert.equal(resolveRoleForEmail('x@uade.edu.ar'), null);
});

test('ALLOWED — verified email resolves role + scope', () => {
  process.env.ALLOWED_USERS_JSON = JSON.stringify([
    { email: 'prof@uade.edu.ar', role: 'teacher', subjects: ['arq-software-2026'] },
    { email: 'alu@uade.edu.ar', role: 'student', subjects: ['arq-software-2026'] },
    { email: 'dir@uade.edu.ar', role: 'director' },
    { email: 'adm@uade.edu.ar', role: 'admin' },
  ]);
  resetAllowlistCache();

  const entry = resolveEntryForEmail('prof@uade.edu.ar');
  assert.equal(entry.role, 'teacher');
  assert.equal(entry.internalRole, 'Docente');
  assert.deepEqual(entry.subjects, ['arq-software-2026']);

  assert.equal(resolveRoleForEmail('prof@uade.edu.ar'), 'Docente');
  assert.deepEqual(resolveScopeForEmail('prof@uade.edu.ar'), { subjects: ['arq-software-2026'], classes: [] });
  assert.equal(resolveRoleForEmail('alu@uade.edu.ar'), 'Alumno');
  assert.equal(resolveRoleForEmail('dir@uade.edu.ar'), 'Director');
  assert.equal(resolveRoleForEmail('adm@uade.edu.ar'), 'Admin');
});

test('CASE_DIFFERENCE — allowlist "Prof@Uade.edu.ar" matches "prof@uade.edu.ar"', () => {
  process.env.ALLOWED_USERS_JSON = JSON.stringify([
    { email: 'Prof@Uade.edu.ar', role: 'teacher', subjects: ['arq-software-2026'] },
  ]);
  resetAllowlistCache();
  assert.equal(resolveRoleForEmail('prof@uade.edu.ar'), 'Docente');
  assert.equal(resolveRoleForEmail(' PROF@UADE.EDU.AR '), 'Docente');
});

test('UNLISTED — verified email absent from allowlist resolves deny', () => {
  process.env.ALLOWED_USERS_JSON = JSON.stringify([
    { email: 'prof@uade.edu.ar', role: 'teacher' },
  ]);
  resetAllowlistCache();
  assert.equal(resolveRoleForEmail('stranger@uade.edu.ar'), null);
  assert.equal(resolveScopeForEmail('stranger@uade.edu.ar'), null);
});

test('MISSING_EMAIL — entry without email is invalid (fail closed)', () => {
  process.env.ALLOWED_USERS_JSON = JSON.stringify([
    { role: 'teacher' },
    { email: '', role: 'student' },
  ]);
  resetAllowlistCache();
  assert.equal(isAllowlistConfigured(), true);
  assert.equal(getAllowlistDiagnostics().invalidEmails.length, 2);
  assert.equal(resolveRoleForEmail(''), null);
});

test('UNVERIFIED_EMAIL — value without @ is invalid (fail closed)', () => {
  process.env.ALLOWED_USERS_JSON = JSON.stringify([
    { email: 'not-an-email', role: 'teacher' },
  ]);
  resetAllowlistCache();
  assert.equal(getAllowlistDiagnostics().invalidEmails.includes('not-an-email'), true);
  assert.equal(resolveRoleForEmail('not-an-email'), null);
});

test('DUPLICATE_IDENTICAL — duplicated email invalidates the entry (fail closed)', () => {
  process.env.ALLOWED_USERS_JSON = JSON.stringify([
    { email: 'prof@uade.edu.ar', role: 'teacher' },
    { email: 'PROF@uade.edu.ar', role: 'teacher' },
  ]);
  resetAllowlistCache();
  assert.equal(getAllowlistDiagnostics().invalidEmails.includes('prof@uade.edu.ar'), true);
  assert.equal(resolveRoleForEmail('prof@uade.edu.ar'), null);
});

test('CONFLICTING — duplicated email with conflicting roles invalidates the entry (fail closed)', () => {
  process.env.ALLOWED_USERS_JSON = JSON.stringify([
    { email: 'prof@uade.edu.ar', role: 'teacher' },
    { email: 'prof@uade.edu.ar', role: 'admin' },
  ]);
  resetAllowlistCache();
  assert.equal(getAllowlistDiagnostics().invalidEmails.includes('prof@uade.edu.ar'), true);
  assert.equal(resolveRoleForEmail('prof@uade.edu.ar'), null);
});

test('INVALID_ROLE — unsupported role invalidates the entry (fail closed)', () => {
  process.env.ALLOWED_USERS_JSON = JSON.stringify([
    { email: 'prof@uade.edu.ar', role: 'superadmin' },
  ]);
  resetAllowlistCache();
  assert.equal(getAllowlistDiagnostics().invalidEmails.includes('prof@uade.edu.ar'), true);
  assert.equal(resolveRoleForEmail('prof@uade.edu.ar'), null);
});

test('INVALID_JSON — malformed env fails closed (not configured)', () => {
  process.env.ALLOWED_USERS_JSON = '{nope';
  resetAllowlistCache();
  assert.equal(isAllowlistConfigured(), true); // raw is non-empty
  assert.equal(getAllowlistDiagnostics().entryCount, 0);
  assert.equal(resolveRoleForEmail('prof@uade.edu.ar'), null);
});

test('NON_ARRAY_JSON — object env fails closed (not configured)', () => {
  process.env.ALLOWED_USERS_JSON = '{"email":"prof@uade.edu.ar","role":"teacher"}';
  resetAllowlistCache();
  assert.equal(getAllowlistDiagnostics().entryCount, 0);
  assert.equal(resolveRoleForEmail('prof@uade.edu.ar'), null);
});

test('SCOPE — subjects and classes preserved', () => {
  process.env.ALLOWED_USERS_JSON = JSON.stringify([
    { email: 'prof@uade.edu.ar', role: 'teacher', subjects: ['arq-software-2026'], classes: ['class-01'] },
  ]);
  resetAllowlistCache();
  assert.deepEqual(resolveScopeForEmail('prof@uade.edu.ar'), {
    subjects: ['arq-software-2026'],
    classes: ['class-01'],
  });
});

test('TO_FRONTEND_ROLE — internal roles map to lowercase frontend roles', () => {
  assert.equal(toFrontendRole('Alumno'), 'student');
  assert.equal(toFrontendRole('Docente'), 'teacher');
  assert.equal(toFrontendRole('Director'), 'director');
  assert.equal(toFrontendRole('Admin'), 'admin');
  assert.equal(toFrontendRole('Anonymous'), undefined);
  assert.equal(toFrontendRole(undefined), undefined);
});

test('NORMALIZE_EMAIL — trims and lowercases', () => {
  assert.equal(normalizeEmail('  Prof@Uade.Edu.Ar  '), 'prof@uade.edu.ar');
  assert.equal(normalizeEmail(''), '');
});

test('EXTRACT_EMAIL_ARRAY_CLAIMS — SWA array claims surface the verified email', () => {
  const principal = {
    claims: [
      { typ: 'emails', val: ['prof@uade.edu.ar', 'other@x.com'] },
      { typ: 'groups', val: ['grp'] },
    ],
  };
  assert.equal(extractVerifiedEmail(principal), 'prof@uade.edu.ar');
});

test('EXTRACT_EMAIL_OBJECT_CLAIMS — OIDC object-shaped claims surface the email', () => {
  const principal = {
    claims: {
      email: 'prof@uade.edu.ar',
      preferred_username: 'prof',
    },
  };
  assert.equal(extractVerifiedEmail(principal), 'prof@uade.edu.ar');
});

test('EXTRACT_EMAIL_DIRECT — principal.email wins over claims', () => {
  const principal = {
    email: 'direct@uade.edu.ar',
    claims: [{ typ: 'email', val: 'claim@uade.edu.ar' }],
  };
  assert.equal(extractVerifiedEmail(principal), 'direct@uade.edu.ar');
});

test('RESOLVE_EMAIL_TRUSTED_WINS — verified principal email beats relayed header', () => {
  const principal = { email: 'trusted@uade.edu.ar' };
  const req = {
    headers: { get: (n) => (n.toLowerCase() === 'x-ms-client-principal-name' ? 'spoofed@evil.com' : null) },
  };
  assert.equal(resolvePrincipalEmail(principal, req), 'trusted@uade.edu.ar');
});

test('RESOLVE_EMAIL_RELAY_FALLBACK — relayed header used only when no verified email', () => {
  const principal = { userId: 'u', userRoles: ['authenticated'], claims: [] };
  const req = {
    headers: { get: (n) => (n.toLowerCase() === 'x-ms-client-principal-name' ? 'relay@uade.edu.ar' : null) },
  };
  assert.equal(resolvePrincipalEmail(principal, req), 'relay@uade.edu.ar');
});

test('RESOLVE_USER_ID — optional pilot key wins over email (Story 10.24)', () => {
  process.env.ALLOWED_USERS_JSON = JSON.stringify([
    { email: 'xavier@uade.edu.ar', role: 'teacher', subjects: ['arq-software-2026'], userId: 'doc-001' },
    { email: 'lvidmar@uade.edu.ar', role: 'student', subjects: ['arq-software-2026'] },
  ]);
  resetAllowlistCache();

  // Entry exposes the pilot data key.
  assert.equal(resolveEntryForEmail('xavier@uade.edu.ar').userId, 'doc-001');
  // resolveUserIdForEmail returns the pilot key when present.
  assert.equal(resolveUserIdForEmail('xavier@uade.edu.ar'), 'doc-001');
  // Falls back to the verified email when no userId is declared.
  assert.equal(resolveUserIdForEmail('lvidmar@uade.edu.ar'), 'lvidmar@uade.edu.ar');
  // Unlisted emails resolve to null.
  assert.equal(resolveUserIdForEmail('ghost@uade.edu.ar'), null);
});
