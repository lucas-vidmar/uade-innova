import { app } from '@azure/functions';
import { withAuth } from '../../../middleware/with-auth.js';
import { withCorrelation } from '../../../middleware/with-correlation.js';
import { validateFrontDoorId, parseClientPrincipal } from '../../../services/auth-utils.js';
import { getEnrollment, listPendingCorrections, listCorrections, getCorrection } from '../../../services/state-store.js';

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
  handler: withCorrelation(withAuth(async (request, context) => {
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
    const correctionId = request.query.get('correctionId');

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

    const userId = context.user?.id || principal?.userId || principal?.oid || 'anonymous';
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
              error: { code: 'ENROLLMENT_INACTIVE', message: 'No tienes permisos de docente para esta materia. Verificá tu inscripción o contactá a administración.' },
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
      const toDto = (c) => ({
        correctionId: c.correctionId,
        studentId: anonymizeStudentId(c.studentId),
        question: c.question,
        originalAnswer: c.originalAnswer,
        correctedAnswer: c.correctedAnswer || '',
        explanation: c.explanation || '',
        issueDetail: c.issueDetail,
        message: c.message || '',
        classId: c.classId,
        status: c.status,
        createdAt: c.createdAt,
        resolvedAt: c.resolvedAt || '',
      });

      // Direct lookup by id (any status): keeps detail reachable after the
      // report leaves Pendiente. Ignoring this param returned an unrelated
      // pending row and the frontend filtered to "no encontrada" (#350).
      if (correctionId) {
        const single = await getCorrection(subjectId, correctionId);
        if (!single || single.subjectId !== subjectId) {
          return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              success: true,
              data: [],
              count: 0,
              meta: {
                timestamp: new Date().toISOString(),
                requestId: context.invocationId,
              },
            }),
          };
        }
        const data = [toDto(single)];
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
      }

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

      // Convergence (UJ-40): reports about the same material fragment must be
      // seen together. Use the key persisted at report time; only records
      // stored before that key existed fall back to a derived one. The fallback
      // keys on the normalized question — the material point that was asked
      // about — because keying on the answer text fused unrelated reports that
      // shared a boilerplate/abstention answer into one inflated group.
      // Order: state, then most-coincident group, then the oldest case first so
      // the biggest/oldest problem is on top.
      const groupKeyOf = (c) => {
        if (c.groupKey) return c.groupKey;
        const head = String(c.question || c.originalAnswer || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120);
        return `${c.classId || 'unknown'}|${head}`;
      };
      const coincidence = new Map();
      for (const c of corrections) {
        const k = groupKeyOf(c);
        coincidence.set(k, (coincidence.get(k) || 0) + 1);
      }

      const statusOrder = { pending: 0, reviewed: 1, resolved: 2, verified: 3 };
      corrections.sort((a, b) => {
        const aOrder = statusOrder[a.status] ?? 99;
        const bOrder = statusOrder[b.status] ?? 99;
        if (aOrder !== bOrder) return aOrder - bOrder;
        const aCount = coincidence.get(groupKeyOf(a)) || 1;
        const bCount = coincidence.get(groupKeyOf(b)) || 1;
        if (aCount !== bCount) return bCount - aCount;
        return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
      });

      const toDtoWithGroup = (c) => {
        const k = groupKeyOf(c);
        return { ...toDto(c), groupKey: k, coincidences: coincidence.get(k) || 1 };
      };

      let data = corrections.map(toDtoWithGroup);

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
  })),
});
