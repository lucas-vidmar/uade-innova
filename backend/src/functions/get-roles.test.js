import { test, mock } from 'node:test';
import assert from 'node:assert';

// Capture handler
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

await import('./get-roles.js');

test('get-roles should return 500 when SWA_ROLES_SECRET is not configured', async () => {
    const logMock = mock.fn();
    logMock.warn = mock.fn();
    logMock.error = mock.fn();
    const mockContext = { log: logMock };
    const mockRequest = { query: new Map([['code', 'anything']]) };

    const response = await handlers['get-roles'](mockRequest, mockContext);
    assert.strictEqual(response.status, 500);
    const body = JSON.parse(response.body);
    assert.ok(body.error.includes('secret'), `unexpected error body: ${body.error}`);
});

test('get-roles should return 401 when code query parameter is missing or invalid', async () => {
    const prevSecret = process.env.SWA_ROLES_SECRET;
    process.env.SWA_ROLES_SECRET = 'test-secret';

    const logMock = mock.fn();
    logMock.warn = mock.fn();
    logMock.error = mock.fn();
    const mockContext = { log: logMock };
    const mockRequest1 = { query: new Map() };
    const mockRequest2 = { query: new Map([['code', 'wrong-code']]) };

    const response1 = await handlers['get-roles'](mockRequest1, mockContext);
    assert.strictEqual(response1.status, 401);

    const response2 = await handlers['get-roles'](mockRequest2, mockContext);
    assert.strictEqual(response2.status, 401);

    process.env.SWA_ROLES_SECRET = prevSecret;
});

test('get-roles should return mapped roles when valid code is provided', async () => {
    const prevSecret = process.env.SWA_ROLES_SECRET;
    process.env.SWA_ROLES_SECRET = 'test-secret';

    const logMock = mock.fn();
    logMock.warn = mock.fn();
    logMock.error = mock.fn();
    const mockContext = { log: logMock };
    const mockRequest = {
        query: new Map([['code', 'test-secret']]),
        json: async () => ({
            claims: [
                { typ: 'groups', val: 'Docentes-Pilot' },
                { typ: 'groups', val: 'Directores-Pilot' }
            ]
        })
    };

    const response = await handlers['get-roles'](mockRequest, mockContext);
    assert.ok(response.jsonBody);
    assert.ok(response.jsonBody.roles.includes('Docente'));
    assert.ok(response.jsonBody.roles.includes('Director'));
    assert.strictEqual(response.jsonBody.roles.length, 2);

    process.env.SWA_ROLES_SECRET = prevSecret;
});
