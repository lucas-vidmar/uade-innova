import { test, mock } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const authMocks = {
    validateFrontDoorId: mock.fn(() => true),
    setStashedIdentity: mock.fn(() => {}),
    parseClientPrincipal: mock.fn(() => ({ userRoles: ['Director'] })),
};

const storageMocks = {
    loadJson: mock.fn(async () => []),
};

const handlers = {};
mock.module('../services/auth-utils.js', { namedExports: authMocks });
mock.module('../services/storage.js', { namedExports: storageMocks });
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
    assert.ok(['stable', 'watchlist', 'at_risk'].includes(item.interventionFlag));
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

function assertTeacherAlertSchema(item) {
    assert.ok(typeof item.id === 'string' && item.id.length > 0);
    assert.ok(['low_engagement', 'material_report'].includes(item.type));
    assert.ok(['medium', 'high'].includes(item.severity));
    assert.ok(typeof item.subjectId === 'string' && item.subjectId.length > 0);
    assert.ok(typeof item.classId === 'string' && item.classId.length > 0);
    assert.ok(typeof item.title === 'string' && item.title.length > 0);
    assert.ok(typeof item.description === 'string' && item.description.length > 0);
    assert.ok(typeof item.recommendedAction === 'string' && item.recommendedAction.length > 0);
    assert.ok(!Number.isNaN(new Date(item.createdAt).getTime()));

    if (item.type === 'low_engagement') {
        assert.ok(typeof item.studentId === 'string' && item.studentId.length > 0);
        assert.ok(typeof item.studentName === 'string' && item.studentName.length > 0);
        assert.match(item.attendance, /^\d{1,3}%$/);
        assert.ok(typeof item.avgGrade === 'number' && item.avgGrade >= 0 && item.avgGrade <= 10);
    }

    if (item.type === 'material_report') {
        assert.ok(typeof item.materialId === 'string' && item.materialId.length > 0);
        assert.ok(typeof item.materialType === 'string' && item.materialType.length > 0);
        assert.ok(Number.isInteger(item.reportCount) && item.reportCount >= 0);
    }
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

test('sga-get-tasks returns an empty task list while no tasks blob exists', async () => {
    storageMocks.loadJson.mock.mockImplementation(async () => null);
    const response = await handlers['sga-get-tasks']({ query: new URLSearchParams({ studentId: 'alu-001' }) }, {});
    assert.equal(response.status, 200);
    const payload = JSON.parse(response.body);
    assert.ok(Array.isArray(payload));
    assert.equal(payload.length, 0);
});

test('sga-get-tasks returns persisted tasks from the tasks-config blob', async () => {
    const persisted = [
        { id: 't-02', studentId: 'alu-001', title: 'Quiz Online', dueDate: '2026-03-20', weight: 10, status: 'disputed', classIds: ['class-02'], grade: 8.5, subjectId: 'arq-software-2026' },
    ];
    storageMocks.loadJson.mock.mockImplementation(async () => persisted);
    const response = await handlers['sga-get-tasks']({ query: new URLSearchParams({ studentId: 'alu-001' }) }, {});
    assert.equal(response.status, 200);
    const payload = JSON.parse(response.body);
    assert.equal(payload.length, 1);
    assert.equal(payload[0].status, 'disputed');
});

test('sga-get-tasks denies access to another student', async () => {
    authMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userId: 'alu-001', userRoles: ['Alumno'] }));
    const prev = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';
    const response = await handlers['sga-get-tasks']({ query: new URLSearchParams({ studentId: 'alu-002' }) }, {});
    assert.equal(response.status, 403);
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prev;
    authMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));
});

test('sga-get-early-alerts returns schema-conformant alerts', async () => {
    const response = await handlers['sga-get-early-alerts']({ query: new URLSearchParams({ subjectId: 'arq-software-2026' }) }, {});
    assert.equal(response.status, 200);
    const payload = JSON.parse(response.body);
    assert.ok(Array.isArray(payload));
    payload.forEach(assertEarlyAlertSchema);
});

test('sga-get-early-alerts returns an empty list while SGA API is not connected', async () => {
    const response = await handlers['sga-get-early-alerts']({ query: new URLSearchParams({ subjectId: 'arq-software-2026' }) }, {});
    assert.equal(response.status, 200);

    const payload = JSON.parse(response.body);
    assert.ok(Array.isArray(payload));
    assert.equal(payload.length, 0);
});

test('sga-get-early-alerts accepts interventionOnly filter and returns an empty list', async () => {
    const response = await handlers['sga-get-early-alerts']({ query: new URLSearchParams({ subjectId: 'arq-software-2026', interventionOnly: 'true' }) }, {});
    assert.equal(response.status, 200);

    const payload = JSON.parse(response.body);
    assert.ok(Array.isArray(payload));
    assert.equal(payload.length, 0);
});

test('sga-get-attendance requires teacher/director access', async () => {
    authMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Alumno'] }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';

    const response = await handlers['sga-get-attendance']({ query: new URLSearchParams({ subjectId: 'arq-software-2026' }) }, {});
    assert.equal(response.status, 403);

    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
});

test('sga-get-attendance returns a null payload for authorized role while SGA API is not connected', async () => {
    authMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Director'] }));
    const response = await handlers['sga-get-attendance']({ query: new URLSearchParams({ subjectId: 'arq-software-2026' }) }, {});
    assert.equal(response.status, 200);

    const payload = JSON.parse(response.body);
    assert.strictEqual(payload.subjectId, 'arq-software-2026');
    assert.strictEqual(payload.average, null);
    assert.strictEqual(payload.trend, null);
});

test('sga-get-teacher-alerts requires subjectId', async () => {
    authMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Docente'] }));
    const response = await handlers['sga-get-teacher-alerts']({ query: new URLSearchParams() }, {});
    assert.equal(response.status, 400);
});

test('sga-get-teacher-alerts requires teacher/director access', async () => {
    authMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Alumno'] }));
    const prevEnv = process.env.AZURE_FUNCTIONS_ENVIRONMENT;
    process.env.AZURE_FUNCTIONS_ENVIRONMENT = 'Production';

    const response = await handlers['sga-get-teacher-alerts']({ query: new URLSearchParams({ subjectId: 'arq-software-2026' }) }, {});
    assert.equal(response.status, 403);

    process.env.AZURE_FUNCTIONS_ENVIRONMENT = prevEnv;
});

test('sga-get-teacher-alerts returns an empty list for authorized role while SGA API is not connected', async () => {
    authMocks.parseClientPrincipal.mock.mockImplementation(() => ({ userRoles: ['Docente'] }));
    const response = await handlers['sga-get-teacher-alerts']({ query: new URLSearchParams({ subjectId: 'arq-software-2026' }) }, {});
    assert.equal(response.status, 200);

    const payload = JSON.parse(response.body);
    assert.ok(Array.isArray(payload));
    assert.equal(payload.length, 0);
});
