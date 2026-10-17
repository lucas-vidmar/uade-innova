/**
 * functions/access-review-api.js — Revisión periódica de permisos con evidencia (UJ-53).
 *
 * Rutas (todas bajo `/api/dashboard-admin/access-review`):
 *
 *   GET  /                       inventario de identidades con su rol, sus permisos
 *                                vigentes y el acto con que cada permiso se otorgó.
 *                                Un permiso sin acto sale marcado `huerfano`, con el
 *                                dato que le falta, nunca disimulado. `?format=csv`
 *                                devuelve el acta en CSV para un tercero.
 *   GET  /decisions              las decisiones aplicadas en la ronda, con responsable,
 *                                motivo, fecha y efecto: el acta que se firma.
 *   POST /decisions              aplica sostener / reducir / retirar sobre una identidad.
 *                                Exige motivo (400 sin él) y asienta quién lo decidió y
 *                                qué efecto quedó, releyendo el estado aplicado.
 *   POST /open                   abre la ronda siguiente (la revisión periódica que
 *                                vuelve a empezar).
 *   POST /sign                   firma el acta. Sólo firma si el digest que declara
 *                                quien firma coincide con el estado aplicado: si algo
 *                                cambió después de la comprobación, devuelve 409.
 *
 * Roles: leer es de dirección y administración (A7 puede leer sin poder escribir);
 * escribir y firmar es sólo de administración.
 */

import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import { listUsers, updateUser, getUserById } from '../services/users-store.js';
import {
  buildAccessReview,
  reviewCsv,
  validateDecision,
  effectFor,
  currentReviewId,
  startReview,
  recordDecision,
  listDecisions,
  readSignature,
  signReview,
  DEFAULT_REVIEW_ID,
} from '../services/access-review.js';
import { structuredErrorResponse, ErrorCategory } from '../services/error-categories.js';

const READ_ROLES = ['Admin', 'Director'];
const WRITE_ROLES = ['Admin'];

function jsonResponse(status, payload) {
  return {
    status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function errorResponse(err) {
  const status = Number(err?.status) || 500;
  const code = err?.code || 'INTERNAL_ERROR';
  return jsonResponse(status, { success: false, error: { code, message: err?.message || 'Error interno' } });
}

function forbidden(message) {
  return structuredErrorResponse(403, message, ErrorCategory.AUTH, 'FORBIDDEN');
}

async function buildInventory() {
  const users = await listUsers();
  const review = buildAccessReview(users);
  const reviewId = await currentReviewId();
  const [decisiones, firma] = await Promise.all([listDecisions(reviewId), readSignature(reviewId)]);
  const abierta = !firma;
  return {
    reviewId: reviewId || DEFAULT_REVIEW_ID,
    estadoActa: abierta ? 'abierta' : 'firmada',
    firma,
    decisiones,
    ...review,
  };
}

// ── GET /api/dashboard-admin/access-review ──────────────────────────────────
app.http('access-review-get', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'dashboard-admin/access-review',
  handler: withCorrelation(withAuth(async (request, context) => {
    try {
      const inventory = await buildInventory();
      const format = (request.query?.get?.('format') || '').toLowerCase();
      if (format === 'csv') {
        context.log(`[AccessReview] Acta CSV de la ronda ${inventory.reviewId}: ${inventory.resumen.huerfanos} huérfanos de ${inventory.resumen.activas} activas.`);
        return {
          status: 200,
          headers: { 'Content-Type': 'text/csv; charset=utf-8' },
          body: reviewCsv(inventory, { reviewId: inventory.reviewId, estado: inventory.estadoActa, firma: inventory.firma, decisiones: inventory.decisiones }),
        };
      }
      return jsonResponse(200, { success: true, data: inventory });
    } catch (err) {
      context.error('[AccessReview] Error armando el inventario:', err);
      return errorResponse(err);
    }
  }, { roles: READ_ROLES })),
});

// ── GET /api/dashboard-admin/access-review/decisions ────────────────────────
app.http('access-review-decisions-get', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'dashboard-admin/access-review/decisions',
  handler: withCorrelation(withAuth(async (request, context) => {
    try {
      const reviewId = await currentReviewId();
      const [decisiones, firma] = await Promise.all([listDecisions(reviewId), readSignature(reviewId)]);
      return jsonResponse(200, {
        success: true,
        data: { reviewId: reviewId || DEFAULT_REVIEW_ID, estadoActa: firma ? 'firmada' : 'abierta', firma, decisiones },
      });
    } catch (err) {
      context.error('[AccessReview] Error leyendo las decisiones:', err);
      return errorResponse(err);
    }
  }, { roles: READ_ROLES })),
});

// ── POST /api/dashboard-admin/access-review/decisions ───────────────────────
app.http('access-review-decide', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'dashboard-admin/access-review/decisions',
  handler: withCorrelation(withAuth(async (request, context) => {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(400, { success: false, error: { code: 'INVALID_BODY', message: 'Invalid JSON body' } });
    }

    const userId = String(body?.userId || '').trim();
    if (!userId) {
      return jsonResponse(400, { success: false, error: { code: 'MISSING_USER_ID', message: 'userId es requerido.' } });
    }

    let decision;
    try {
      decision = validateDecision(body || {});
    } catch (err) {
      return errorResponse(err);
    }

    try {
      const reviewId = await currentReviewId();
      const firma = await readSignature(reviewId);
      // Un acta firmada ya no admite decisiones: la ronda siguiente se abre con /open.
      if (firma) {
        return jsonResponse(409, {
          success: false,
          error: {
            code: 'REVIEW_SIGNED',
            message: `El acta de la ronda ${reviewId} ya está firmada (${firma.signedBy || 'sin firmante'} · ${firma.signedAt || 'sin fecha'}). Abrí la ronda siguiente antes de aplicar otra decisión.`,
          },
        });
      }

      const before = await getUserById(userId);
      if (!before) {
        return jsonResponse(404, { success: false, error: { code: 'USER_NOT_FOUND', message: `No existe un usuario con id "${userId}".` } });
      }

      const inventoryBefore = buildAccessReview([before]);
      const efecto = effectFor(before, decision.decision);
      const decidedBy = context.user?.id || context.user?.userId || null;

      const applied = await updateUser(userId, {
        ...(efecto.role !== before.role ? { role: efecto.role } : {}),
        ...(efecto.status !== (before.status || 'active') ? { status: efecto.status } : {}),
        reason: decision.reason,
        actor: decidedBy,
      });

      // Se relee el estado aplicado: el acta asienta lo que quedó, no lo que se pidió.
      const after = await getUserById(userId);
      const inventoryAfter = buildAccessReview([after]);
      const registro = await recordDecision({
        reviewId,
        userId,
        decision: decision.decision,
        reason: decision.reason,
        decidedBy,
        efecto: {
          rolAntes: before.role, rolDespues: after?.role ?? null,
          estadoAntes: before.status || 'active', estadoDespues: after?.status || 'active',
        },
        digestBefore: inventoryBefore.digest,
        digestAfter: inventoryAfter.digest,
      });

      context.log(`[AccessReview] ${decision.decision} sobre ${userId} por ${decidedBy}: ${before.role}->${after?.role}, ${before.status || 'active'}->${after?.status || 'active'}`);
      return jsonResponse(200, {
        success: true,
        data: {
          reviewId,
          decision: registro,
          aplicado: {
            userId: after?.userId || userId,
            role: after?.role ?? null,
            status: after?.status || 'active',
            evidencia: inventoryAfter.entries[0]?.evidencia || null,
          },
          pedido: { role: applied?.role ?? null, status: applied?.status || 'active' },
        },
      });
    } catch (err) {
      context.error('[AccessReview] Error aplicando la decisión:', err);
      return errorResponse(err);
    }
  }, { roles: WRITE_ROLES })),
});

// ── POST /api/dashboard-admin/access-review/open ────────────────────────────
app.http('access-review-open', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'dashboard-admin/access-review/open',
  handler: withCorrelation(withAuth(async (request, context) => {
    try {
      const actor = context.user?.id || context.user?.userId || null;
      const previous = await currentReviewId();
      const reviewId = await startReview({ actor });
      context.log(`[AccessReview] Ronda nueva ${reviewId} (anterior ${previous}) abierta por ${actor}`);
      return jsonResponse(201, { success: true, data: { reviewId, previousReviewId: previous } });
    } catch (err) {
      context.error('[AccessReview] Error abriendo la ronda:', err);
      return errorResponse(err);
    }
  }, { roles: WRITE_ROLES })),
});

// ── POST /api/dashboard-admin/access-review/sign ────────────────────────────
app.http('access-review-sign', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'dashboard-admin/access-review/sign',
  handler: withCorrelation(withAuth(async (request, context) => {
    let body;
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    try {
      const reviewId = await currentReviewId();
      const firma = await readSignature(reviewId);
      if (firma) {
        return jsonResponse(409, {
          success: false,
          error: { code: 'REVIEW_SIGNED', message: `El acta de la ronda ${reviewId} ya está firmada.` },
        });
      }

      const inventory = await buildInventory();
      const declarado = String(body?.digest || '').trim();
      if (!declarado) {
        return jsonResponse(400, { success: false, error: { code: 'MISSING_DIGEST', message: 'Hay que declarar el digest del inventario que se comprobó.' } });
      }
      // Paso 6 de UJ-53: no se puede cerrar el acta sobre algo distinto de lo
      // aplicado. Si el conjunto cambió después de la comprobación, no firma.
      if (declarado !== inventory.digest) {
        return jsonResponse(409, {
          success: false,
          error: {
            code: 'STALE_DIGEST',
            message: 'El inventario cambió desde la comprobación: lo aplicado no coincide con lo que se está firmando. Volvé a comprobar antes de firmar.',
            expectedDigest: inventory.digest,
          },
        });
      }

      const signedBy = context.user?.id || context.user?.userId || null;
      const registro = await signReview({
        reviewId,
        signedBy,
        digest: inventory.digest,
        note: body?.note ? String(body.note).slice(0, 500) : null,
        decisiones: inventory.decisiones.length,
      });
      context.log(`[AccessReview] Acta ${reviewId} firmada por ${signedBy} sobre ${inventory.decisiones.length} decisiones y ${inventory.resumen.huerfanos} huérfanos.`);
      return jsonResponse(200, {
        success: true,
        data: {
          reviewId,
          firma: registro,
          resumen: inventory.resumen,
          decisiones: inventory.decisiones.length,
          faltasHeredadas: inventory.huerfanos,
        },
      });
    } catch (err) {
      context.error('[AccessReview] Error firmando el acta:', err);
      return errorResponse(err);
    }
  }, { roles: WRITE_ROLES })),
});
