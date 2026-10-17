import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import { getTableClient } from '../services/storage.js';
import { validateFrontDoorId } from '../services/auth-utils.js';
import {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  getUserById,
  setUserPassword,
  generateRandomPassword,
} from '../services/users-store.js';
import { deleteSessionsForUser } from '../services/sessions-store.js';
import { recordIdentityChange, listIdentityChanges } from '../services/identity-audit-store.js';
import { deactivateEnrollmentsForUser } from '../services/state-store.js';
import { CONFIG } from '../services/config.js';
import { structuredErrorResponse, ErrorCategory } from '../services/error-categories.js';

const USER_PROFILES_TABLE = 'UserProfiles';

function jsonResponse(status, payload) {
  return {
    status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function authError(status, code, message) {
  return structuredErrorResponse(status, message, ErrorCategory.AUTH, code);
}

function errorResponse(err) {
  const status = Number(err?.status) || 500;
  const code = err?.code || 'INTERNAL_ERROR';
  return jsonResponse(status, { success: false, error: { code, message: err?.message || 'Error interno' } });
}

/**
 * Quién hizo el cambio, para la constancia (UJ-52 paso 9).
 */
function actorOf(context) {
  return {
    actor: context?.user?.id || context?.user?.userId || null,
    actorRole: context?.user?.role || null,
  };
}

async function loadUserProfiles() {
  try {
    const client = getTableClient(USER_PROFILES_TABLE);
    await client.createTable().catch(() => {});
    const profiles = {};
    for await (const entity of client.listEntities()) {
      profiles[entity.rowKey] = entity;
    }
    return profiles;
  } catch (err) {
    console.error('[AdminAPI] Error loading user profiles:', err.message);
    return {};
  }
}

function toAdminUserView(user, profile) {
  return {
    id: user.userId,
    userId: user.userId,
    name: user.name,
    surname: user.surname,
    email: user.email,
    role: user.role,
    status: user.status,
    mustChangePassword: user.mustChangePassword === true,
    theme: profile?.theme,
    language: profile?.language,
    consentAccepted: profile?.consentAccepted || false,
    lastActive: profile?.timestamp,
    // UJ-53: el acto con que se otorgó el permiso vigente y el que fijó su
    // estado. Sin estos campos la superficie muestra un rol como si se
    // sostuviera solo; con ellos la revisión de accesos puede decir de cada
    // permiso si tiene dueño, motivo y fecha, o si quedó huérfano.
    createdAt: user.createdAt || null,
    grantedBy: user.grantedBy || null,
    grantedAt: user.grantedAt || null,
    grantReason: user.grantReason || null,
    statusChangedBy: user.statusChangedBy || null,
    statusChangedAt: user.statusChangedAt || null,
    statusChangeReason: user.statusChangeReason || null,
  };
}

/**
 * Lists every user (role derived from the Users table, profile preferences
 * merged from UserProfiles). Legacy route kept for backward compatibility;
 * the frontend uses /api/admin/users.
 */
app.http('manage-get-users', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'manage/users',
  handler: withCorrelation(withAuth(async (request, context) => {
    if (!validateFrontDoorId(request)) return jsonResponse(403, { success: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    try {
      if (!['Director', 'Admin'].includes(context.user?.role)) {
        return jsonResponse(403, { success: false, error: { code: 'FORBIDDEN', message: 'Administrator access required' } });
      }
      const [users, profiles] = await Promise.all([listUsers(), loadUserProfiles()]);
      return {
        jsonBody: users.map((user) => toAdminUserView(user, profiles[user.userId])),
      };
    } catch (error) {
      context.error('Error fetching users for admin:', error);
      return { status: 500, body: 'Internal Server Error' };
    }
  })),
});

// ── GET /api/admin/users (teacher+director+admin) ──────────────────
app.http('admin-list-users', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'dashboard-admin/users',
  handler: withCorrelation(withAuth(async (request, context) => {
    try {
      const [users, profiles] = await Promise.all([listUsers(), loadUserProfiles()]);
      return jsonResponse(200, { success: true, data: users.map((user) => toAdminUserView(user, profiles[user.userId])) });
    } catch (err) {
      context.error('[AdminAPI] Error listing users:', err);
      return errorResponse(err);
    }
  }, { roles: ['Admin', 'Director', 'Docente'] })),
});

// ── POST /api/admin/users (admin only) ──────────────────────────────
app.http('admin-create-user', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'dashboard-admin/users',
  handler: withCorrelation(withAuth(async (request, context) => {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(400, { success: false, error: { code: 'INVALID_BODY', message: 'Invalid JSON body' } });
    }

    const { userId, name, surname, email, role, password, generatePassword, status, mustChangePassword } = body || {};
    let finalPassword = String(password || '');
    if (generatePassword) {
      finalPassword = generateRandomPassword();
    }
    if (!finalPassword) {
      return jsonResponse(400, { success: false, error: { code: 'MISSING_PASSWORD', message: 'Se requiere una contraseña o generar una aleatoria.' } });
    }
    if (!generatePassword && finalPassword.length < 8) {
      return jsonResponse(400, { success: false, error: { code: 'WEAK_PASSWORD', message: 'La contraseña debe tener al menos 8 caracteres.' } });
    }

    try {
      const created = await createUser({
        userId,
        name,
        surname,
        email,
        role,
        password: finalPassword,
        status,
        mustChangePassword: mustChangePassword !== false,
        // UJ-53: el alta es un acto de otorgamiento — queda su dueño y su motivo.
        grantedBy: context.user?.id || context.user?.userId || null,
        grantReason: String(body?.reason || '').trim() || null,
      });
      // UJ-52 paso 9: el alta también queda asentada, con quién la hizo.
      const constancia = await recordIdentityChange({
        ...actorOf(context),
        target: created.userId,
        targetEmail: created.email,
        action: 'create',
        reason: body?.reason,
        after: { role: created.role, status: created.status },
      });
      context.log(`[AdminAPI] User created: ${created.userId} (${created.email})`);
      return jsonResponse(201, {
        success: true,
        data: created,
        generatedPassword: generatePassword ? finalPassword : undefined,
        constancia,
      });
    } catch (err) {
      return errorResponse(err);
    }
  }, { roles: ['Admin'] })),
});

// ── PUT /api/admin/users/{id} (admin only) ──────────────────────────
app.http('admin-update-user', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'dashboard-admin/users/{id}',
  handler: withCorrelation(withAuth(async (request, context) => {
    const id = request.params?.id;
    if (!id) {
      return jsonResponse(400, { success: false, error: { code: 'MISSING_USER_ID', message: 'userId is required' } });
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(400, { success: false, error: { code: 'INVALID_BODY', message: 'Invalid JSON body' } });
    }
    try {
      const before = await getUserById(id);
      // UJ-53: el cambio de rol o de estado se asienta con su dueño (quien opera)
      // y con el motivo declarado, para que el permiso no quede sin acto.
      const updated = await updateUser(id, {
        ...(body || {}),
        actor: context.user?.id || context.user?.userId || null,
        reason: String(body?.reason || '').trim() || null,
      });
      // UJ-52 paso 4: deshabilitar la identidad tiene que retirar también sus
      // permisos, no sólo su credencial. Una matrícula que sigue `active`
      // deja a la persona que ya no entra figurando como tenedora del permiso.
      let revokedEnrollments = null;
      if (updated?.status === 'disabled') {
        revokedEnrollments = await deactivateEnrollmentsForUser(id);
      }
      // UJ-52 paso 9: la constancia dice quién, cuándo, por qué y con qué
      // alcance (el estado anterior y el nuevo), no sólo que «se actualizó».
      const action = updated?.status === 'disabled'
        ? 'disable'
        : (before?.status === 'disabled' && updated?.status === 'active' ? 'enable' : 'update');
      const constancia = await recordIdentityChange({
        ...actorOf(context),
        target: updated?.userId || id,
        targetEmail: updated?.email || before?.email,
        action,
        reason: body?.reason,
        before: { role: before?.role, status: before?.status },
        after: { role: updated?.role, status: updated?.status },
        scope: action === 'disable' ? { access: 'cerrado' } : null,
      });
      context.log(`[AdminAPI] User updated: ${updated.userId} (${action}); permisos retirados: ${revokedEnrollments?.count ?? 0}`);
      return jsonResponse(200, { success: true, data: updated, constancia, revokedEnrollments });
    } catch (err) {
      return errorResponse(err);
    }
  }, { roles: ['Admin'] })),
});

// ── DELETE /api/admin/users/{id} (admin only) ───────────────────────
app.http('admin-delete-user', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'dashboard-admin/users/{id}',
  handler: withCorrelation(withAuth(async (request, context) => {
    const id = request.params?.id;
    if (!id) {
      return jsonResponse(400, { success: false, error: { code: 'MISSING_USER_ID', message: 'userId is required' } });
    }
    // El motivo de la baja es opcional, pero si viene se asienta (UJ-52 paso 9).
    let body = {};
    try {
      body = (await request.json()) || {};
    } catch {
      body = {};
    }
    try {
      const before = await getUserById(id);
      const deleted = await deleteUser(id);
      if (!deleted) {
        return jsonResponse(404, { success: false, error: { code: 'USER_NOT_FOUND', message: `No existe un usuario con id "${id}".` } });
      }
      // Revoke all sessions so a deleted account cannot keep using tokens.
      await deleteSessionsForUser(id);
      // UJ-52 paso 4: borrar la identidad también retira sus permisos.
      const revokedEnrollments = await deactivateEnrollmentsForUser(id);
      // UJ-52 paso 9: la baja queda asentada con fecha, quién la hizo y motivo.
      const constancia = await recordIdentityChange({
        ...actorOf(context),
        target: id,
        targetEmail: before?.email,
        action: 'delete',
        reason: body?.reason,
        before: { role: before?.role, status: before?.status },
        after: { status: 'deleted' },
        scope: { access: 'cerrado', sessions: 'revocadas' },
      });
      context.log(`[AdminAPI] User deleted: ${id}; permisos retirados: ${revokedEnrollments.count}`);
      return jsonResponse(200, { success: true, data: { deleted: true }, constancia, revokedEnrollments });
    } catch (err) {
      return errorResponse(err);
    }
  }, { roles: ['Admin'] })),
});

// ── POST /api/admin/users/{id}/reset-password (admin only) ──────────
app.http('admin-reset-password', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'dashboard-admin/users/{id}/reset-password',
  handler: withCorrelation(withAuth(async (request, context) => {
    const id = request.params?.id;
    if (!id) {
      return jsonResponse(400, { success: false, error: { code: 'MISSING_USER_ID', message: 'userId is required' } });
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(400, { success: false, error: { code: 'INVALID_BODY', message: 'Invalid JSON body' } });
    }
    const newPassword = String(body?.password || '') || generateRandomPassword();
    try {
      const updated = await setUserPassword(id, newPassword, { mustChangePassword: true });
      if (!updated) {
        return jsonResponse(404, { success: false, error: { code: 'USER_NOT_FOUND', message: `No existe un usuario con id "${id}".` } });
      }
      // Reset forces re-auth everywhere except the admin's own session.
      const adminId = context.user?.id;
      await deleteSessionsForUser(id, adminId === id ? request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') : undefined);
      // UJ-52 paso 9: el reseteo también queda asentado (nunca la contraseña).
      const constancia = await recordIdentityChange({
        ...actorOf(context),
        target: id,
        action: 'reset-password',
        reason: body?.reason,
        after: { mustChangePassword: true },
        scope: { sessions: adminId === id ? 'la propia se conserva' : 'revocadas' },
      });
      context.log(`[AdminAPI] Password reset: ${id}`);
      return jsonResponse(200, {
        success: true,
        data: { userId: id, mustChangePassword: true },
        generatedPassword: newPassword,
        constancia,
      });
    } catch (err) {
      return errorResponse(err);
    }
  }, { roles: ['Admin'] })),
});

// ── GET /api/dashboard-admin/identity-audit?userId=… (admin/director) ─
// UJ-52 paso 9: alguien que no participó del corte tiene que poder
// reconstruir qué se cerró, cuándo y por qué. La constancia es de lectura.
app.http('admin-identity-audit', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'dashboard-admin/identity-audit',
  handler: withCorrelation(withAuth(async (request, context) => {
    const userId = request.query?.get?.('userId');
    if (!userId) {
      return jsonResponse(400, { success: false, error: { code: 'MISSING_USER_ID', message: 'userId es requerido' } });
    }
    try {
      const cambios = await listIdentityChanges(userId);
      return jsonResponse(200, { success: true, data: cambios });
    } catch (err) {
      context.error('[AdminAPI] Error reading identity audit:', err);
      return errorResponse(err);
    }
  }, { roles: ['Admin', 'Director'] })),
});
