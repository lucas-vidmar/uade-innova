import { test, mock } from 'node:test';
import assert from 'node:assert';

// Capture the handler, bypassing the withAuth/withCorrelation wrappers so we can
// drive the allowlist-resolved user directly (Story 1.1a contract test).
const handlers = {};
mock.module('@azure/functions', {
  namedExports: {
    app: {
      http: (name, options) => {
        handlers[name] = options.handler;
      },
    },
  },
});

mock.module('../middleware/with-auth.js', {
  namedExports: {
    withAuth: (handler) => handler,
  },
});
mock.module('../middleware/with-correlation.js', {
  namedExports: {
    withCorrelation: (handler) => handler,
  },
});

const authUtilsMocks = {
  validateFrontDoorId: mock.fn(() => true),
  parseClientPrincipal: mock.fn(() => null),
  getAuthenticatedUser: mock.fn(() => null),
  // Mirrors the real resolveIdentityKey: session identity first.
  resolveIdentityKey: mock.fn((request, context) => context?.user?.userId || 'pilot-user'),
  // Mirrors the real hasResolvedIdentity: nobody without a real identity (#434).
  hasResolvedIdentity: mock.fn((user) => {
    if (!user) return false;
    const role = user.role;
    if (!role || role === 'Anonymous' || role === 'Denied') return false;
    const id = user.userId || user.id;
    return Boolean(id) && id !== 'anonymous' && id !== 'pilot-user';
  }),
};
mock.module('../services/auth-utils.js', { namedExports: authUtilsMocks });
mock.module('../services/telemetry.js', {
  namedExports: { trackUserLogin: mock.fn(async () => {}) },
});

let entityToReturn = null;
let lastGetEntityArgs = null;
const storageMocks = {
  getTableClient: mock.fn(() => ({
    getEntity: mock.fn(async (pk, rk) => {
      lastGetEntityArgs = [pk, rk];
      if (entityToReturn) return entityToReturn;
      const err = new Error('Not Found');
      err.statusCode = 404;
      throw err;
    }),
  })),
};
mock.module('../services/storage.js', { namedExports: storageMocks });

await import('./get-profile.js');

function makeContext() {
  const log = mock.fn();
  log.error = mock.fn();
  return { log, error: log.error };
}

test('get-profile returns allowlist-resolved role/email/scope in the profile contract', async () => {
  const context = makeContext();
  context.user = {
    userId: 'lvidmar@uade.edu.ar',
    role: 'Docente',
    email: 'lvidmar@uade.edu.ar',
    scope: { subjects: ['arq-software-2026'], classes: [] },
    principal: { userRoles: ['authenticated', 'Docente'] },
  };
  const res = await handlers['get-profile']({}, context);
  const body = res.jsonBody;
  assert.equal(body.role, 'teacher');
  assert.equal(body.email, 'lvidmar@uade.edu.ar');
  assert.deepEqual(body.scope, { subjects: ['arq-software-2026'], classes: [] });
  assert.equal(body.consentAccepted, false);
});

test('get-profile falls back to student role for anonymous/unknown roles (no lockout)', async () => {
  const context = makeContext();
  context.user = {
    userId: 'legacy-user',
    role: 'Anonymous',
    email: undefined,
    scope: undefined,
    principal: null,
  };
  const res = await handlers['get-profile']({}, context);
  const body = res.jsonBody;
  assert.equal(body.role, 'student');
});

test('get-profile returns default bot preferences when profile does not exist (11-5-1)', async () => {
  entityToReturn = null;
  const context = makeContext();
  context.user = { userId: 'alu-001', role: 'Alumno', email: 'alu@uade.edu.ar', scope: undefined, principal: null };
  const res = await handlers['get-profile']({}, context);
  const body = res.jsonBody;
  assert.equal(body.botTone, 'formal');
  assert.equal(body.botLength, 'detailed');
  assert.equal(body.includeSources, true);
});

test('get-profile returns persisted bot preferences from UserProfiles (11-5-1)', async () => {
  entityToReturn = {
    theme: 'dark',
    language: 'es',
    consentAccepted: 'true',
    botTone: 'didactic',
    botLength: 'concise',
    includeSources: 'false',
  };
  const context = makeContext();
  context.user = { userId: 'alu-001', role: 'Alumno', email: 'alu@uade.edu.ar', scope: undefined, principal: null };
  const res = await handlers['get-profile']({}, context);
  const body = res.jsonBody;
  assert.equal(body.botTone, 'didactic');
  assert.equal(body.botLength, 'concise');
  assert.equal(body.includeSources, false);
  assert.equal(body.consentAccepted, true);
  entityToReturn = null;
});

test('get-profile normalizes invalid stored bot preferences to defaults (11-5-1)', async () => {
  entityToReturn = {
    theme: 'dark',
    language: 'es',
    consentAccepted: 'false',
    botTone: 'agresivo',
    botLength: 'extenso',
    includeSources: 'yes',
  };
  const context = makeContext();
  context.user = { userId: 'alu-001', role: 'Alumno', email: 'alu@uade.edu.ar', scope: undefined, principal: null };
  const res = await handlers['get-profile']({}, context);
  const body = res.jsonBody;
  assert.equal(body.botTone, 'formal');
  assert.equal(body.botLength, 'detailed');
  assert.equal(body.includeSources, true);
  assert.equal(body.consentAccepted, false);
  entityToReturn = null;
});

// #329: the read key is the session identity — the same row save-profile
// writes — even when no oid-bearing principal exists.
test('get-profile reads the session-identity row (#329)', async () => {
  entityToReturn = { botTone: 'didactic' };
  lastGetEntityArgs = null;
  const context = makeContext();
  context.user = { userId: 'alu-009', role: 'Alumno', email: 'alu09@uade.edu.ar', scope: undefined, principal: null };
  const res = await handlers['get-profile']({}, context);
  assert.deepEqual(lastGetEntityArgs, ['Profiles', 'alu-009']);
  assert.equal(res.jsonBody.botTone, 'didactic');
  entityToReturn = null;
});

// #434: sin identidad no hay fila que leer. Antes, un pedido anónimo recibía la
// fila compartida 'pilot-user' (consentAccepted:true, botTone:'didactic'): el
// perfil guardado de otra persona. El contrato se responde con los defaults.
test('#434: un pedido sin identidad no lee el perfil guardado de la fila compartida', async () => {
  entityToReturn = { theme: 'dark', consentAccepted: 'true', botTone: 'didactic' };
  lastGetEntityArgs = null;
  const context = makeContext();
  context.user = { userId: 'anonymous', role: 'Anonymous', email: undefined, scope: undefined, principal: null };

  const res = await handlers['get-profile']({}, context);
  const body = res.jsonBody;

  assert.equal(lastGetEntityArgs, null, 'no debe leer UserProfiles sin identidad resuelta');
  assert.equal(body.consentAccepted, false, 'no debe exponer el consentimiento de la fila compartida');
  assert.equal(body.botTone, 'formal', 'no debe exponer las preferencias de la fila compartida');
  assert.equal(body.role, 'student');
  entityToReturn = null;
});

// ── #375: constancia de la entrada guiada ─────────────────────────
test('get-profile returns null onboarding fields when there is no record (#375)', async () => {
  entityToReturn = null;
  const context = makeContext();
  context.user = { userId: 'alu-001', role: 'Alumno', email: 'alu@uade.edu.ar', scope: undefined, principal: null };
  const res = await handlers['get-profile']({}, context);
  const body = res.jsonBody;
  assert.equal(body.onboardingStatus, null);
  assert.equal(body.onboardingAt, null);
  assert.equal(body.onboardingStep, null);
});

test('get-profile returns the persisted onboarding record with its date (#375)', async () => {
  entityToReturn = {
    theme: 'light',
    language: 'es',
    consentAccepted: 'true',
    onboardingStatus: 'completed',
    onboardingAt: '2026-10-16T12:34:56.000Z',
    onboardingStep: 3,
  };
  const context = makeContext();
  context.user = { userId: 'alu-001', role: 'Alumno', email: 'alu@uade.edu.ar', scope: undefined, principal: null };
  const res = await handlers['get-profile']({}, context);
  const body = res.jsonBody;
  assert.equal(body.onboardingStatus, 'completed');
  assert.equal(body.onboardingAt, '2026-10-16T12:34:56.000Z');
  assert.equal(body.onboardingStep, 3);
  entityToReturn = null;
});

test('get-profile normalizes an invalid onboarding status to null (#375)', async () => {
  entityToReturn = { onboardingStatus: 'terminado', onboardingAt: 'ayer', onboardingStep: 'tres' };
  const context = makeContext();
  context.user = { userId: 'alu-001', role: 'Alumno', email: 'alu@uade.edu.ar', scope: undefined, principal: null };
  const res = await handlers['get-profile']({}, context);
  const body = res.jsonBody;
  assert.equal(body.onboardingStatus, null);
  assert.equal(body.onboardingAt, null);
  assert.equal(body.onboardingStep, null);
  entityToReturn = null;
});
