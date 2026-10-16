import { app } from '@azure/functions';
import { withCorrelation } from '../../../middleware/with-correlation.js';
import { withAuth } from '../../../middleware/with-auth.js';
import { validateFrontDoorId } from '../../../services/auth-utils.js';
import { getEnrollment, getCorrection, updateCorrectionStatus } from '../../../services/state-store.js';
import { logWarn } from '../../../services/log.js';

const VALID_STATUSES = ['pending', 'resolved'];

app.http('update-correction-status', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  route: 'corrections-status',
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

    const principal = context.principal;

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

    const { correctionId, subjectId, status, comments } = body || {};

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

      if (correction.status === 'resolved') {
        return {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: { code: 'ALREADY_RESOLVED', message: 'La corrección ya fue resuelta.' },
          }),
        };
      }

      // Saga: Pendiente -> (nota) Verificado -> (cierre) Resuelto (#350).
      // Verified is an intermediate state; only Resuelto closes it.
      if (correction.status === 'verified') {
        if (status !== 'resolved') {
          return {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              success: false,
              error: { code: 'INVALID_TRANSITION', message: 'Una corrección verificada solo puede pasar a Resuelto.' },
            }),
          };
        }
      } else if (correction.status !== 'pending') {
        return {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: { code: 'INVALID_TRANSITION', message: 'Solo se pueden resolver correcciones pendientes o verificadas.' },
          }),
        };
      }

      const previousStatus = correction.status;

      const updated = await updateCorrectionStatus(subjectId, correctionId, status, comments);

      // Race condition guard: re-read to confirm this request won the update
      const reRead = await getCorrection(subjectId, correctionId);
      if (!reRead || reRead.status !== status) {
        logWarn(context, `[update-correction-status] Race condition detected for correctionId=${correctionId}. Expected status=${status} but got=${reRead?.status}.`);
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
  }, { roles: ['Docente', 'Director'] })),
});
