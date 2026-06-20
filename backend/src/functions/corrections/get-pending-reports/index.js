import { app } from '@azure/functions';
import { validateFrontDoorId, parseClientPrincipal } from '../../../services/auth-utils.js';
import { getEnrollment, listPendingCorrections, listCorrections } from '../../../services/state-store.js';

function canReadTeacherAlerts(principal) {
  if (process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development') return true;
  const roles = principal?.userRoles || [];
  return roles.includes('Docente') || roles.includes('Director');
}

function anonymizeStudentId(studentId) {
  if (!studentId || studentId.length < 2) return 'A.A.';

  // Numeric-only IDs: mask most digits, keep first and last visible
  if (/^\d+$/.test(studentId)) {
    return studentId.length > 4
      ? `${studentId[0]}***${studentId.slice(-1)}`
      : `${studentId[0]}*`;
  }

  // Email IDs: extract initials from local part
  const localPart = studentId.split('@')[0];
  const parts = localPart.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = (parts[0][0] || 'A').toUpperCase();
    const last = (parts[parts.length - 1][0] || 'A').toUpperCase();
    return `${first}.${last}.`;
  }
  return `${localPart[0].toUpperCase()}.A.`;
}

app.http('get-pending-reports', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'corrections-pending',
  handler: async (request, context) => {
    if (!validateFrontDoorId(request)) {
      return {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Forbidden - Invalid Front Door ID' },
        }),
      };
    }

    const principal = parseClientPrincipal(request);
    if (!canReadTeacherAlerts(principal)) {
      return {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Acceso denegado. Se requiere rol Docente o Director.' },
        }),
      };
    }

    const subjectId = request.query.get('subjectId');
    const classId = request.query.get('classId');
    const statusFilter = request.query.get('status');

    if (!subjectId) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: { code: 'MISSING_SUBJECT', message: 'Falta subjectId' },
        }),
      };
    }

    const userId = principal?.userId || principal?.oid || 'anonymous';
    const isDirector = principal?.userRoles?.includes('Director');

    if (!isDirector && process.env.AZURE_FUNCTIONS_ENVIRONMENT !== 'Development') {
      try {
        const enrollment = await getEnrollment(subjectId, userId);
        if (!enrollment || enrollment.role !== 'teacher' || enrollment.status !== 'active') {
          return {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              success: false,
              error: { code: 'FORBIDDEN', message: 'No tienes permisos de docente para esta materia.' },
            }),
          };
        }
      } catch (err) {
        return {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Error verificando permisos de docente.' },
          }),
        };
      }
    }

    try {
      let corrections;
      if (statusFilter === 'all') {
        corrections = await listCorrections(subjectId);
      } else if (statusFilter) {
        const validFilters = ['pending', 'reviewed', 'resolved', 'verified'];
        if (!validFilters.includes(statusFilter)) {
          return {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              success: false,
              error: { code: 'INVALID_STATUS', message: `Filtro de estado inválido: ${statusFilter}. Valores permitidos: ${validFilters.join(', ')}.` },
            }),
          };
        }
        corrections = await listCorrections(subjectId, statusFilter);
      } else {
        corrections = await listPendingCorrections(subjectId);
      }

      const statusOrder = { pending: 0, reviewed: 1, resolved: 2, verified: 3 };
      corrections.sort((a, b) => {
        const aOrder = statusOrder[a.status] ?? 99;
        const bOrder = statusOrder[b.status] ?? 99;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      });

      let data = corrections.map((c) => ({
        correctionId: c.correctionId,
        studentId: anonymizeStudentId(c.studentId),
        question: c.question,
        originalAnswer: c.originalAnswer,
        issueDetail: c.issueDetail,
        classId: c.classId,
        status: c.status,
        createdAt: c.createdAt,
      }));

      if (classId) {
        data = data.filter((c) => c.classId === classId);
      }

      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          data,
          count: data.length,
          meta: {
            timestamp: new Date().toISOString(),
            requestId: context.invocationId,
          },
        }),
      };
    } catch (err) {
      context.error(`[get-pending-reports] Error: ${err.message}`, {
        error: err.message,
        subjectId,
        requestId: context.invocationId,
      });

      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Error obteniendo correcciones pendientes.' },
          meta: { timestamp: new Date().toISOString(), requestId: context.invocationId },
        }),
      };
    }
  },
});
