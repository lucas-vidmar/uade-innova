import { test, mock } from 'node:test';
import assert from 'node:assert';

const mockStateStore = {
    getEnrollment: mock.fn(),
    getCorrection: mock.fn(),
    updateCorrectionStatus: mock.fn(),
};

const mockAuthUtils = {
    validateFrontDoorId: mock.fn(() => true),
    parseClientPrincipal: mock.fn(() => ({
        userId: 'teacher-1',
        userRoles: ['Docente'],
        oid: 'teacher-1',
    })),
    setStashedIdentity: mock.fn(() => {}),
};

let capturedHandler;
mock.module('@azure/functions', {
    namedExports: {
        app: {
            http: (name, options) => {
                capturedHandler = options.handler;
            },
        },
    },
});
mock.module('../../../services/auth-utils.js', { namedExports: mockAuthUtils });
mock.module('../../../services/state-store.js', { namedExports: mockStateStore });

await import('./index.js');

test('update-correction-status registers an http function via app.http', () => {
    assert.ok(capturedHandler, 'app.http debe registrar el handler');
    assert.strictEqual(typeof capturedHandler, 'function');
});
