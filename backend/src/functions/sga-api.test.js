import { test, mock } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const authMocks = {
    validateFrontDoorId: mock.fn(() => true),
    parseClientPrincipal: mock.fn(() => ({ userRoles: ['Director'] })),
};

const handlers = {};
mock.module('../services/auth-utils.js', { namedExports: authMocks });
mock.module('@azure/functions', {
    namedExports: {
        app: {
            http: (name, options) => {
                handlers[name] = options.handler;
            },
        },
    },
});

await import('./sga-api.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OPENAPI_PATH = path.resolve(__dirname, '../../../docs/sga-openapi.json');

function assertTaskSchema(task) {
    assert.ok(typeof task.id === 'string' && task.id.length > 0);
    assert.ok(typeof task.studentId === 'string' && task.studentId.length > 0);
    assert.ok(typeof task.title === 'string' && task.title.length > 0);
    assert.match(task.dueDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(typeof task.weight === 'number' && task.weight >= 0 && task.weight <= 100);
    assert.ok(['pending', 'completed'].includes(task.status));
    assert.ok(Array.isArray(task.classIds));
    assert.ok(task.grade === null || (typeof task.grade === 'number' && task.grade >= 0 && task.grade <= 10));
    assert.ok(typeof task.subjectId === 'string' && task.subjectId.length > 0);
}

function assertEarlyAlertSchema(item) {
    assert.ok(typeof item.id === 'string' && item.id.length > 0);
    assert.ok(typeof item.studentId === 'string' && item.studentId.length > 0);
    assert.ok(typeof item.name === 'string' && item.name.length > 0);
    assert.ok(typeof item.subjectId === 'string' && item.subjectId.length > 0);
    assert.ok(typeof item.subject === 'string' && item.subject.length > 0);
    assert.ok(['low', 'medium', 'high'].includes(item.risk));
    assert.match(item.attendance, /^\d{1,3}%$/);
    assert.ok(typeof item.avgGrade === 'number' && item.avgGrade >= 0 && item.avgGrade <= 10);
}

function assertAttendanceSchema(item) {
    assert.ok(typeof item.average === 'number' && item.average >= 0 && item.average <= 100);
    assert.ok(Number.isInteger(item.critical) && item.critical >= 0);
    assert.ok(['up', 'down', 'stable'].includes(item.trend));
    assert.ok(typeof item.subjectId === 'string' && item.subjectId.length > 0);
    assert.ok(!Number.isNaN(new Date(item.updatedAt).getTime()));
}

test('sga-openapi artifact exists and defines required SGA paths', async () => {
    const raw = await readFile(OPENAPI_PATH, 'utf8');
    const spec = JSON.parse(raw);

    assert.equal(spec.openapi, '3.0.3');
    assert.ok(spec.paths['/sga/tasks']);
    assert.ok(spec.paths['/sga/early-alerts']);
    assert.ok(spec.paths['/sga/attendance']);
    assert.ok(spec.components?.schemas?.SgaTask);
    assert.ok(spec.components?.schemas?.SgaEarlyAlert);
    assert.ok(spec.components?.schemas?.SgaAttendanceStats);
});

test('sga-get-tasks returns 400 when studentId is missing', async () => {
    const response = await handlers['sga-get-tasks']({ query: new URLSearchParams() }, {});
    assert.equal(response.status, 400);
});

test('sga-get-tasks returns schema-conformant tasks', async () => {
    const response = await handlers['sga-get-tasks']({ query: new URLSearchParams({ studentId: 'alu-001' }) }, {});
    assert.equal(response.status, 200);
    const payload = JSON.parse(response.body);
    assert.ok(Array.isArray(payload) && payload.length > 0);
    payload.forEach(assertTaskSchema);
});

test('sga-get-early-alerts returns schema-conformant alerts', async () => {
    const response = await handlers['sga-get-early-alerts']({ query: new URLSearchParams({ subjectId: 'arq-software-2026' }) }, {});
    assert.equal(response.status, 200);
    const payload = JSON.parse(response.body);
    assert.ok(Array.isArray(payload));
    payload.forEach(assertEarlyAlertSchema);
});

test('sga-get-attendance requires teacher/director access', async () => {
    authMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Alumno'] }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';

    const response = await handlers['sga-get-attendance']({ query: new URLSearchParams({ subjectId: 'arq-software-2026' }) }, {});
    assert.equal(response.status, 403);

    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
});

test('sga-get-attendance returns schema-conformant payload for authorized role', async () => {
    authMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));
    const response = await handlers['sga-get-attendance']({ query: new URLSearchParams({ subjectId: 'arq-software-2026' }) }, {});
    assert.equal(response.status, 200);

    const payload = JSON.parse(response.body);
    assertAttendanceSchema(payload);
});
