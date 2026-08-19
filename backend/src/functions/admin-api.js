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
  setUserPassword,
  generateRandomPassword,
} from '../services/users-store.js';
import { deleteSessionsForUser } from '../services/sessions-store.js';
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

// ── GET /api/admin/users (admin only) ───────────────────────────────
app.http('admin-list-users', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'admin/users',
  handler: withCorrelation(withAuth(async (request, context) => {
    try {
      const [users, profiles] = await Promise.all([listUsers(), loadUserProfiles()]);
      return jsonResponse(200, { success: true, data: users.map((user) => toAdminUserView(user, profiles[user.userId])) });
    } catch (err) {
      context.error('[AdminAPI] Error listing users:', err);
      return errorResponse(err);
    }
  }, { roles: ['Admin'] })),
});

// ── POST /api/admin/users (admin only) ──────────────────────────────
app.http('admin-create-user', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'admin/users',
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
      });
      context.log(`[AdminAPI] User created: ${created.userId} (${created.email})`);
      return jsonResponse(201, {
        success: true,
        data: created,
        generatedPassword: generatePassword ? finalPassword : undefined,
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
  route: 'admin/users/{id}',
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
      const updated = await updateUser(id, body || {});
      context.log(`[AdminAPI] User updated: ${updated.userId}`);
      return jsonResponse(200, { success: true, data: updated });
    } catch (err) {
      return errorResponse(err);
    }
  }, { roles: ['Admin'] })),
});

// ── DELETE /api/admin/users/{id} (admin only) ───────────────────────
app.http('admin-delete-user', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'admin/users/{id}',
  handler: withCorrelation(withAuth(async (request, context) => {
    const id = request.params?.id;
    if (!id) {
      return jsonResponse(400, { success: false, error: { code: 'MISSING_USER_ID', message: 'userId is required' } });
    }
    try {
      const deleted = await deleteUser(id);
      if (!deleted) {
        return jsonResponse(404, { success: false, error: { code: 'USER_NOT_FOUND', message: `No existe un usuario con id "${id}".` } });
      }
      // Revoke all sessions so a deleted account cannot keep using tokens.
      await deleteSessionsForUser(id);
      context.log(`[AdminAPI] User deleted: ${id}`);
      return jsonResponse(200, { success: true, data: { deleted: true } });
    } catch (err) {
      return errorResponse(err);
    }
  }, { roles: ['Admin'] })),
});

// ── POST /api/admin/users/{id}/reset-password (admin only) ──────────
app.http('admin-reset-password', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'admin/users/{id}/reset-password',
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
      context.log(`[AdminAPI] Password reset: ${id}`);
      return jsonResponse(200, {
        success: true,
        data: { userId: id, mustChangePassword: true },
        generatedPassword: newPassword,
      });
    } catch (err) {
      return errorResponse(err);
    }
  }, { roles: ['Admin'] })),
});
