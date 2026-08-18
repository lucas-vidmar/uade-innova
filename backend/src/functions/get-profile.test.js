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
};
mock.module('../services/auth-utils.js', { namedExports: authUtilsMocks });
mock.module('../services/telemetry.js', {
  namedExports: { trackUserLogin: mock.fn(async () => {}) },
});

let entityToReturn = null;
const storageMocks = {
  getTableClient: mock.fn(() => ({
    getEntity: mock.fn(async () => {
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
