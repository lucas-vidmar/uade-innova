import { test, mock } from 'node:test';
import assert from 'node:assert';

const authUtilsMocks = {
    validateFrontDoorId: mock.fn(() => true),
    setStashedIdentity: mock.fn(() => {}),
    parseClientPrincipal: mock.fn(() => ({ oid: 'alu-001', userDetails: 'alu@uade.edu.ar' })),
    getAuthenticatedUser: mock.fn(() => null),
    // Mirrors the real resolveIdentityKey: session identity first.
    resolveIdentityKey: mock.fn((request, context) => context?.user?.userId || 'pilot-user'),
};

let profileStore = {};

function mergeEntity(existing, incoming) {
    return { ...(existing || {}), ...incoming };
}

const storageMocks = {
    getTableClient: mock.fn(() => {
        return {
            createTable: mock.fn(async () => {}),
            getEntity: mock.fn(async (pk, rk) => {
                const key = `${pk}:${rk}`;
                if (!profileStore[key]) {
                    const err = new Error('Not Found');
                    err.statusCode = 404;
                    throw err;
                }
                return profileStore[key];
            }),
            upsertEntity: mock.fn(async (entity, mode) => {
                const key = `${entity.partitionKey}:${entity.rowKey}`;
                if (mode === 'Merge') {
                    profileStore[key] = mergeEntity(profileStore[key], entity);
                } else {
                    profileStore[key] = entity;
                }
            }),
        };
    }),
};

mock.module('../services/auth-utils.js', { namedExports: authUtilsMocks });
mock.module('../services/storage.js', { namedExports: storageMocks });

const handlers = {};
mock.module('@azure/functions', {
    namedExports: {
        app: {
            http: (name, options) => {
                handlers[name] = options.handler;
            }
        }
    }
});

await import('./save-profile.js');

function makeContext() {
    return { log: mock.fn(), error: mock.fn(), warn: mock.fn() };
}

function makeRequest(body) {
    return {
        headers: { get: () => null },
        json: async () => body,
    };
}

test.beforeEach(() => { profileStore = {}; });

test('save-profile persists bot preferences to UserProfiles (11-5-1)', async () => {
    const ctx = makeContext();
    const req = makeRequest({ botTone: 'didactic', botLength: 'concise', includeSources: false });
    const res = await handlers['save-profile'](req, ctx);
    assert.strictEqual(res.status, 200);
    const entity = profileStore['Profiles:alu-001'];
    assert.ok(entity, 'entity should be upserted');
    assert.strictEqual(entity.botTone, 'didactic');
    assert.strictEqual(entity.botLength, 'concise');
    assert.strictEqual(entity.includeSources, false);
});

test('save-profile partial update preserves existing theme/language/consent (11-5-1)', async () => {
    profileStore['Profiles:alu-001'] = {
        partitionKey: 'Profiles',
        rowKey: 'alu-001',
        theme: 'dark',
        language: 'en',
        consentAccepted: true,
        botTone: 'formal',
        botLength: 'detailed',
        includeSources: true,
    };
    const ctx = makeContext();
    const req = makeRequest({ botTone: 'formal' });
    const res = await handlers['save-profile'](req, ctx);
    assert.strictEqual(res.status, 200);
    const entity = profileStore['Profiles:alu-001'];
    assert.strictEqual(entity.theme, 'dark');
    assert.strictEqual(entity.language, 'en');
    assert.strictEqual(entity.consentAccepted, true);
    assert.strictEqual(entity.botLength, 'detailed');
});

test('save-profile invalid bot preference values are dropped, preserving stored values (11-5-1)', async () => {
    profileStore['Profiles:alu-001'] = {
        partitionKey: 'Profiles',
        rowKey: 'alu-001',
        theme: 'dark',
        language: 'es',
        consentAccepted: true,
        botTone: 'didactic',
        botLength: 'concise',
        includeSources: false,
    };
    const ctx = makeContext();
    const req = makeRequest({ botTone: 'agresivo', botLength: 'extenso', includeSources: 'yes' });
    const res = await handlers['save-profile'](req, ctx);
    assert.strictEqual(res.status, 200);
    const entity = profileStore['Profiles:alu-001'];
    assert.strictEqual(entity.botTone, 'didactic', 'existing valid botTone must be preserved');
    assert.strictEqual(entity.botLength, 'concise', 'existing valid botLength must be preserved');
    assert.strictEqual(entity.includeSources, false, 'existing includeSources must be preserved');
    assert.strictEqual(entity.theme, 'dark');
    assert.strictEqual(entity.consentAccepted, true);
});

test('save-profile invalid bot preference values on fresh profile omit the fields (11-5-1)', async () => {
    const ctx = makeContext();
    const req = makeRequest({ botTone: 'agresivo', botLength: 'extenso', includeSources: 'yes' });
    const res = await handlers['save-profile'](req, ctx);
    assert.strictEqual(res.status, 200);
    const entity = profileStore['Profiles:alu-001'];
    assert.strictEqual(entity.botTone, undefined, 'invalid botTone must not be persisted');
    assert.strictEqual(entity.botLength, undefined, 'invalid botLength must not be persisted');
    assert.strictEqual(entity.includeSources, undefined, 'invalid includeSources must not be persisted');
});

test('save-profile tolerates a null body (11-5-1)', async () => {
    const ctx = makeContext();
    const req = makeRequest(null);
    const res = await handlers['save-profile'](req, ctx);
    assert.strictEqual(res.status, 200);
    const entity = profileStore['Profiles:alu-001'];
    assert.ok(entity, 'profile row should still be created');
    assert.strictEqual(entity.botTone, undefined);
});

// ── #329 regression: save key must equal get-profile read key ─────
// get-profile reads `Profiles/{sessionUserId}`. A session principal has no
// oid, so keying the write by `principal?.oid` landed on 'pilot-user' and
// every save was silently lost on reload.
test('save-profile writes under the session identity, not pilot-user (#329)', async () => {
    const defaultPrincipal = () => ({ oid: 'alu-001', userDetails: 'alu@uade.edu.ar' });
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({
        userId: 'alu-009',
        userDetails: 'alu09@uade.edu.ar',
        userRoles: ['authenticated', 'Alumno'],
    }));
    try {
        const ctx = makeContext();
        const req = makeRequest({ botTone: 'didactic', botLength: 'concise' });
        const res = await handlers['save-profile'](req, ctx);
        assert.strictEqual(res.status, 200);
        const entity = profileStore['Profiles:alu-009'];
        assert.ok(entity, 'profile must be stored under the session userId (get-profile read key)');
        assert.strictEqual(entity.botTone, 'didactic');
        assert.ok(!profileStore['Profiles:pilot-user'], 'profile must NOT fall back to pilot-user');
    } finally {
        authUtilsMocks.parseClientPrincipal.mock.mockImplementation(defaultPrincipal);
    }
});

// ── #375: constancia de la entrada guiada ─────────────────────────
test('save-profile persists the onboarding record flattened (#375)', async () => {
    const ctx = makeContext();
    const req = makeRequest({
        onboarding: { status: 'completed', at: '2026-10-16T12:34:56.000Z', step: 3 },
    });
    const res = await handlers['save-profile'](req, ctx);
    assert.strictEqual(res.status, 200);
    const entity = profileStore['Profiles:alu-001'];
    assert.strictEqual(entity.onboardingStatus, 'completed');
    assert.strictEqual(entity.onboardingAt, '2026-10-16T12:34:56.000Z');
    assert.strictEqual(entity.onboardingStep, 3);
});

test('save-profile keeps a dismissed record distinct from completed (#375)', async () => {
    const ctx = makeContext();
    const req = makeRequest({ onboarding: { status: 'dismissed', at: '2026-10-16T09:00:00.000Z', step: 0 } });
    const res = await handlers['save-profile'](req, ctx);
    assert.strictEqual(res.status, 200);
    const entity = profileStore['Profiles:alu-001'];
    assert.strictEqual(entity.onboardingStatus, 'dismissed');
    assert.strictEqual(entity.onboardingStep, 0);
});

test('save-profile drops an invalid onboarding status, preserving the stored one (#375)', async () => {
    profileStore['Profiles:alu-001'] = {
        partitionKey: 'Profiles',
        rowKey: 'alu-001',
        onboardingStatus: 'completed',
        onboardingAt: '2026-10-16T08:00:00.000Z',
    };
    const ctx = makeContext();
    const req = makeRequest({ onboarding: { status: 'terminado', at: 'no-es-fecha' } });
    const res = await handlers['save-profile'](req, ctx);
    assert.strictEqual(res.status, 200);
    const entity = profileStore['Profiles:alu-001'];
    assert.strictEqual(entity.onboardingStatus, 'completed', 'invalid status must not overwrite');
    assert.strictEqual(entity.onboardingAt, '2026-10-16T08:00:00.000Z');
});

