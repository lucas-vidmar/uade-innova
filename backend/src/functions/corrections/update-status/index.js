import { app } from '@azure/functions';
import { withCorrelation } from '../../../middleware/with-correlation.js';
import { validateFrontDoorId, parseClientPrincipal } from '../../../services/auth-utils.js';
import { getEnrollment, getCorrection, updateCorrectionStatus } from '../../../services/state-store.js';

function canReadTeacherAlerts(principal) {
  if (process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development') return true;
  const roles = principal?.userRoles || [];
  return roles.includes('Docente') || roles.includes('Director');
}

const VALID_STATUSES = ['pending', 'reviewed', 'resolved'];

app.http('update-correction-status', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'corrections-status',
  handler: withCorrelation(async (request, context) => {
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

    let body;
    try {
      body = await request.json();
    } catch {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'El cuerpo de la solicitud debe ser JSON válido.' },
        }),
      };
    }

    const { correctionId, subjectId, status } = body || {};

    if (!correctionId || !subjectId || !status) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Faltan campos requeridos: correctionId, subjectId, status.' },
        }),
      };
    }

    if (!VALID_STATUSES.includes(status)) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: { code: 'INVALID_STATUS', message: `Estado inválido. Valores permitidos: ${VALID_STATUSES.join(', ')}.` },
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
      const correction = await getCorrection(subjectId, correctionId);
      if (!correction) {
        return {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Corrección no encontrada.' },
          }),
        };
      }

      if (correction.status === 'verified' || correction.status === 'resolved') {
        return {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: { code: 'ALREADY_RESOLVED', message: 'La corrección ya fue resuelta o verificada.' },
          }),
        };
      }

      if (status === 'reviewed' && correction.status !== 'pending') {
        return {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: { code: 'INVALID_TRANSITION', message: 'Solo se pueden marcar como revisadas las correcciones pendientes.' },
          }),
        };
      }

      const previousStatus = correction.status;

      const updated = await updateCorrectionStatus(subjectId, correctionId, status);

      // Race condition guard: re-read to confirm this request won the update
      const reRead = await getCorrection(subjectId, correctionId);
      if (!reRead || reRead.status !== status) {
        context.log.warn(`[update-correction-status] Race condition detected for correctionId=${correctionId}. Expected status=${status} but got=${reRead?.status}.`);
        return {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            data: { correctionId, status: reRead?.status || status },
            meta: { timestamp: new Date().toISOString(), requestId: context.invocationId },
          }),
        };
      }

      context.log(`[update-correction-status] Correction ${correctionId} ${previousStatus} → ${status} (teacherId=${userId})`);

      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          data: {
            correctionId: updated.correctionId,
            status: updated.status,
          },
          meta: {
            timestamp: new Date().toISOString(),
            requestId: context.invocationId,
          },
        }),
      };
    } catch (err) {
      context.error(`[update-correction-status] Error: ${err.message}`, {
        error: err.message,
        correctionId,
        subjectId,
        userId,
        requestId: context.invocationId,
      });

      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Error actualizando estado de la corrección.' },
          meta: { timestamp: new Date().toISOString(), requestId: context.invocationId },
        }),
      };
    }
  }),
});
