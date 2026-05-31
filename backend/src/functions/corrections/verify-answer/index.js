import { app } from '@azure/functions';
import { validateFrontDoorId, parseClientPrincipal } from '../../../services/auth-utils.js';
import { getEnrollment, getCorrection, upsertCorrection, deletePendingCorrection } from '../../../services/state-store.js';
import { generateEmbedding } from '../../../services/ai.js';
import { upsertChunks } from '../../../services/vector-store.js';

function canReadTeacherAlerts(principal) {
  if (process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development') return true;
  const roles = principal?.userRoles || [];
  return roles.includes('Docente') || roles.includes('Director');
}

const MAX_EXPLANATION_LENGTH = 5000;

app.http('verify-answer', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'corrections-verify',
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

    const { correctionId, subjectId, correctedAnswer, explanation } = body || {};

    if (!correctionId || !subjectId || !correctedAnswer || !correctedAnswer.trim()) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Faltan campos requeridos: correctionId, subjectId, correctedAnswer.' },
        }),
      };
    }

    if (explanation !== undefined && (typeof explanation !== 'string' || explanation.length > MAX_EXPLANATION_LENGTH)) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: { code: 'INVALID_INPUT', message: `La explicación debe ser texto y no superar ${MAX_EXPLANATION_LENGTH} caracteres.` },
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

      if (correction.status !== 'pending') {
        return {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: { code: 'ALREADY_VERIFIED', message: 'Esta corrección ya fue verificada.' },
          }),
        };
      }

      const now = new Date().toISOString();

      const updatedCorrection = {
        correctionId: correction.correctionId,
        subjectId: correction.subjectId,
        classId: correction.classId,
        studentId: correction.studentId,
        teacherId: userId,
        question: correction.question,
        originalAnswer: correction.originalAnswer,
        correctedAnswer: correctedAnswer.trim(),
        explanation: typeof explanation === 'string' ? explanation.trim() : '',
        issueDetail: correction.issueDetail,
        messageId: correction.messageId,
        status: 'verified',
        createdAt: correction.createdAt,
        resolvedAt: now,
      };

      await upsertCorrection(updatedCorrection);

      // Race condition guard: re-read to confirm this request won the update
      const reRead = await getCorrection(subjectId, correctionId);
      if (!reRead || reRead.teacherId !== userId) {
        context.log.warn(`[verify-answer] Race condition detected for correctionId=${correctionId}. Another request may have verified first. Skipping Pinecone upsert.`);
        return {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            data: { correctionId, status: 'verified' },
            meta: {
              timestamp: now,
              requestId: context.invocationId,
            },
          }),
        };
      }

      await deletePendingCorrection(correctionId);

      let embedding;
      try {
        const result = await generateEmbedding(correctedAnswer.trim());
        embedding = result.embedding;
      } catch (embedErr) {
        context.error(`[verify-answer] Embedding generation failed for correctionId=${correctionId}:`, {
          error: embedErr.message,
          correctionId,
          subjectId,
          requestId: context.invocationId,
        });
        return {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: { code: 'EMBEDDING_FAILED', message: 'Error generando el embedding. Intentá de nuevo.' },
            meta: { timestamp: new Date().toISOString(), requestId: context.invocationId },
          }),
        };
      }

      try {
        await upsertChunks([{
          id: `verified-${correctionId}`,
          values: embedding,
          metadata: {
            materialType: 'verified-answer',
            subjectId,
            classId: correction.classId,
            originalQuestion: correction.question,
            teacherId: userId,
            sourceFilename: `correction-${correctionId}`,
            lectureDate: now,
            chunkIndex: 0,
            materialId: `corr-${correctionId}`,
          },
        }]);
      } catch (pineconeErr) {
        context.error(`[verify-answer] Pinecone upsert failed AFTER table update for correctionId=${correctionId}. The correction is marked verified but NOT searchable in RAG. Manual reconciliation required.`, {
          error: pineconeErr.message,
          correctionId,
          subjectId,
          requestId: context.invocationId,
        });
        return {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            error: { code: 'PINECONE_UPSERT_FAILED', message: 'La corrección fue guardada pero no se pudo publicar en el índice de búsqueda. Contactá a soporte.' },
            meta: { timestamp: new Date().toISOString(), requestId: context.invocationId },
          }),
        };
      }

      context.log(`[verify-answer] Correction verified (correctionId=${correctionId}, subjectId=${subjectId}, teacherId=${userId})`);

      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          data: { correctionId, status: 'verified' },
          meta: {
            timestamp: now,
            requestId: context.invocationId,
          },
        }),
      };
    } catch (err) {
      context.error(`[verify-answer] Error verifying correction ${correctionId}:`, {
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
          error: { code: 'INTERNAL_ERROR', message: 'Error publicando corrección. Intentá de nuevo.' },
          meta: { timestamp: new Date().toISOString(), requestId: context.invocationId },
        }),
      };
    }
  },
});
