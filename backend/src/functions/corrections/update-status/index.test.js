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

function contextoDocente() {
    return {
        log: () => {},
        error: () => {},
        principal: { userId: 'teacher-1', userRoles: ['Docente'] },
    };
}

function pedido(cuerpo) {
    return { json: async () => cuerpo, headers: new Map() };
}

test('#552: marcar un reporte como revisado se acepta y persiste ese estado', async () => {
    mockStateStore.getEnrollment.mock.mockImplementation(async () => ({ status: 'active', role: 'teacher' }));
    // Primera lectura: pendiente. Relectura de control de carrera: ya revisado.
    // El orden se lleva con un contador propio: mockImplementationOnce no respeta
    // el orden en que se encola.
    let lecturas = 0;
    mockStateStore.getCorrection.mock.mockImplementation(async () => {
        lecturas += 1;
        return { correctionId: 'c-1', subjectId: 'arq-software-2026', status: lecturas === 1 ? 'pending' : 'reviewed' };
    });
    mockStateStore.updateCorrectionStatus.mock.mockImplementation(async () => ({ correctionId: 'c-1', status: 'reviewed' }));

    const response = await capturedHandler(
        pedido({ correctionId: 'c-1', subjectId: 'arq-software-2026', status: 'reviewed' }),
        contextoDocente(),
    );

    assert.strictEqual(response.status, 200, 'el front ofrece «Revisado»: la escritura tiene que aceptarlo');
    const body = JSON.parse(response.body);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.status, 'reviewed');
    assert.strictEqual(
        mockStateStore.updateCorrectionStatus.mock.calls.at(-1).arguments[2],
        'reviewed',
        'el estado tiene que llegar al almacén tal cual',
    );
});

test('#552: un reporte ya revisado se puede cerrar', async () => {
    mockStateStore.getEnrollment.mock.mockImplementation(async () => ({ status: 'active', role: 'teacher' }));
    let lecturas = 0;
    mockStateStore.getCorrection.mock.mockImplementation(async () => {
        lecturas += 1;
        return { correctionId: 'c-2', subjectId: 'arq-software-2026', status: lecturas === 1 ? 'reviewed' : 'resolved' };
    });
    mockStateStore.updateCorrectionStatus.mock.mockImplementation(async () => ({ correctionId: 'c-2', status: 'resolved' }));

    const response = await capturedHandler(
        pedido({ correctionId: 'c-2', subjectId: 'arq-software-2026', status: 'resolved' }),
        contextoDocente(),
    );

    assert.strictEqual(response.status, 200, 'un reporte revisado no puede quedar sin poder cerrarse');
});

test('#552: un estado que no existe sigue rechazándose con 400', async () => {
    mockStateStore.getEnrollment.mock.mockImplementation(async () => ({ status: 'active', role: 'teacher' }));
    // El contador de llamadas es acumulado entre pruebas del archivo.
    mockStateStore.updateCorrectionStatus.mock.resetCalls();

    const response = await capturedHandler(
        pedido({ correctionId: 'c-1', subjectId: 'arq-software-2026', status: 'inventado' }),
        contextoDocente(),
    );

    assert.strictEqual(response.status, 400);
    assert.strictEqual(JSON.parse(response.body).error.code, 'INVALID_STATUS');
    assert.strictEqual(mockStateStore.updateCorrectionStatus.mock.callCount(), 0);
});
