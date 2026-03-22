import { test, mock } from 'node:test';
import assert from 'node:assert';

// Define mocks before importing
const authUtilsMocks = {
    parseClientPrincipal: mock.fn(() => ({ userRoles: [] }))
};

const storageMocks = {
    loadJson: mock.fn(async () => ({})),
    saveJson: mock.fn(async () => true),
    deleteBlob: mock.fn(async () => true),
    listBlobs: mock.fn(async () => [])
};

// Mock dependencies
mock.module('../services/auth-utils.js', { namedExports: authUtilsMocks });
mock.module('../services/storage.js', { namedExports: storageMocks });
mock.module('uuid', { namedExports: { v4: () => '1234' } });

// Capture multiple handlers since there are multiple routes
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

// Import the function under test
await import('./classes-api.js');

test('classes-api save-class-map should return 403 for unauthorized users', async (t) => {
    // Reset mock to simulate unauthorized user
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Alumno'] }));
    
    // Default environment state isn't development to test roles
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = "Production";

    const mockContext = { log: mock.fn(), error: mock.fn() };
    const mockRequest = { params: { classId: 'test-class' } };

    const response = await handlers['save-class-map'](mockRequest, mockContext);
    assert.strictEqual(response.status, 403, 'Should return 403 Forbidden');
    
    const body = JSON.parse(response.body);
    assert.strictEqual(body.error, 'Forbidden - Teacher access required');

    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
});

test('classes-api save-class-map should return 200 for Docente', async (t) => {
    // Reset mock to simulate authorized user
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Docente'] }));
    
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = "Production";

    const mockContext = { log: mock.fn(), error: mock.fn() };
    const mockRequest = { 
        params: { classId: 'test-class' },
        json: async () => ({ mapCode: 'mock-map' })
    };

    const response = await handlers['save-class-map'](mockRequest, mockContext);
    assert.strictEqual(response.status, 200, 'Should return 200 OK');

    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
});

test('classes-api save-class-summary should require authorization', async (t) => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Guest'] }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = "Production";

    const mockContext = { log: mock.fn(), error: mock.fn() };
    const mockRequest = { params: { classId: '123' }, json: async () => ({ summary: 'test' }) };

    const response = await handlers['save-class-summary'](mockRequest, mockContext);
    assert.strictEqual(response.status, 403);

    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
});

test('classes-api delete-material should require authorization', async (t) => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: [] }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = "Production";

    const mockContext = { log: mock.fn(), error: mock.fn() };
    const mockRequest = { params: { materialId: '123' } };

    const response = await handlers['delete-material'](mockRequest, mockContext);
    assert.strictEqual(response.status, 403);

    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
});

test('classes-api save-classes should require authorization', async (t) => {
    authUtilsMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: [] }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = "Production";

    const mockContext = { log: mock.fn(), error: mock.fn() };
    const mockRequest = { 
        query: new Map([['subjectId', 'test']]), 
        json: async () => ([]) 
    };

    const response = await handlers['save-classes'](mockRequest, mockContext);
    assert.strictEqual(response.status, 403);

    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
});
