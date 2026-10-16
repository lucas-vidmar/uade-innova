import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import { createStructuredLogger } from '../services/structured-logger.js';
import { upsertClassView, listClassViewsBySubject, listClassViewsByStudent } from '../services/state-store.js';
import { parseClientPrincipal, validateFrontDoorId, readDevIdentityHeader } from '../services/auth-utils.js';
import { getEnrollment } from '../services/state-store.js';

app.http('track-class-view', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'class-views',
    handler: withCorrelation(withAuth(async (request, context) => {
        const log = createStructuredLogger('track-class-view', context);
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };

        let body;
        try {
            body = await request.json();
        } catch {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Cuerpo de la solicitud inválido' }) };
        }

        const { classId, subjectId } = body || {};
        if (!classId || !subjectId) {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Faltan classId y/o subjectId' }) };
        }

        const principal = parseClientPrincipal(request);
        const userId = principal?.userId || principal?.oid || readDevIdentityHeader(request, 'x-edu-uid') || 'anonymous';

        try {
            const enrollment = await getEnrollment(subjectId, userId);
            if (!enrollment || enrollment.status !== 'active') {
                return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'No tienes acceso a esta materia.' }) };
            }
        } catch (err) {
            return { status: 500, body: JSON.stringify({ error: 'Error al verificar permisos.' }) };
        }

        try {
            const result = await upsertClassView(subjectId, userId, classId);
            log.info('Class view tracked', { userId, classId, subjectId, viewCount: result.viewCount });
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ success: true, viewedAt: result.viewedAt, viewCount: result.viewCount }),
            };
        } catch (err) {
            log.error('Error tracking class view', err);
            return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Error interno al registrar la vista.' }) };
        }
    })),
});

app.http('get-class-views', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'class-views',
    handler: withCorrelation(withAuth(async (request, context) => {
        const log = createStructuredLogger('get-class-views', context);
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };

        const subjectId = request.query.get('subjectId');
        const targetUserId = request.query.get('userId');

        if (!subjectId) {
            return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Falta subjectId' }) };
        }

        const principal = parseClientPrincipal(request);
        const roles = principal?.userRoles || [];
        const isTeacher = roles.includes('Docente');
        const isDirector = roles.includes('Director');
        const sessionUserId = principal?.userId || principal?.oid || readDevIdentityHeader(request, 'x-edu-uid');
        const authUserId = sessionUserId || 'anonymous';

        // Fail closed: sin identidad resuelta no hay vistas que devolver. Servir el
        // bucket 'anonymous' era el resto visible del agujero de suplantación por
        // encabezado (el endpoint devolvía historial de otro alumno con solo
        // mandar x-edu-uid).
        if (!sessionUserId) {
            return {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Se requiere autenticación para ver las vistas de clase.', code: 'AUTH_REQUIRED' }),
            };
        }

        try {
            let views;
            if (targetUserId && (isTeacher || isDirector)) {
                // Teacher/Director asking for a specific student's views
                views = await listClassViewsByStudent(subjectId, targetUserId);
            } else if (targetUserId && targetUserId === authUserId) {
                // Student asking for their own views
                views = await listClassViewsByStudent(subjectId, authUserId);
            } else if (isTeacher || isDirector) {
                // Teacher/Director asking for all views in subject (for analytics)
                views = await listClassViewsBySubject(subjectId);
            } else {
                // Student: only their own views
                views = await listClassViewsByStudent(subjectId, authUserId);
            }

            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(views),
            };
        } catch (err) {
            log.error('Error fetching class views', err);
            return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Error interno al obtener vistas.' }) };
        }
    })),
});
