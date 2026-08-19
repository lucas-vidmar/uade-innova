/**
 * functions/auth-api.js — Email+password login, logout, me, change-password.
 *
 * Replaces the SWA EasyAuth (`/.auth/me`, `/.auth/login/aad`) path:
 *   - POST /api/auth/login           → validate credentials, create opaque session
 *   - POST /api/auth/logout          → delete the presented session
 *   - GET  /api/auth/me              → current user + role/scope (session token)
 *   - POST /api/auth/change-password → self-service change (current password)
 *
 * Passwords are verified against scrypt hashes (never compared in plaintext) and
 * login attempts are rate-limited (reuses rate-limiter.js). Unknown emails and
 * wrong passwords return the SAME generic 401 so the endpoint does not reveal
 * whether an email exists.
 */

import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import { createRateLimiter } from '../services/rate-limiter.js';
import {
  getUserByEmailWithPassword,
  getUserById,
  verifyPassword,
  setUserPassword,
  normalizeEmail,
  INTERNAL_ROLE_BY_ROLE,
  FRONTEND_ROLE_BY_INTERNAL,
} from '../services/users-store.js';
import {
  createSession,
  deleteSession,
  deleteSessionsForUser,
} from '../services/sessions-store.js';
import { getEnrollmentsByUser } from '../services/state-store.js';
import { CONFIG } from '../services/config.js';
import { structuredErrorResponse, ErrorCategory } from '../services/error-categories.js';

const loginLimiter = createRateLimiter({
  windowMs: CONFIG.auth.loginRateLimit.windowMs,
  tiers: {
    login: CONFIG.auth.loginRateLimit.attempts,
    general: CONFIG.auth.loginRateLimit.attempts,
  },
});

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

function extractBearerToken(request) {
  const authHeader = request?.headers?.get?.('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  return match ? match[1].trim() : null;
}

function clientIp(request) {
  const forwarded = request?.headers?.get?.('x-forwarded-for');
  if (forwarded) return String(forwarded).split(',')[0].trim() || 'unknown';
  return 'unknown';
}

async function resolveScopeForUser(userId) {
  const enrollments = await getEnrollmentsByUser(userId);
  const subjects = [...new Set(
    enrollments.filter((e) => e.status === 'active').map((e) => e.subjectId)
  )].filter(Boolean);
  return { subjects, classes: [] };
}

function publicUser(user, scope) {
  return {
    id: user.userId,
    name: user.name,
    surname: user.surname,
    email: user.email,
    role: FRONTEND_ROLE_BY_INTERNAL[INTERNAL_ROLE_BY_ROLE[user.role]] || user.role,
    status: user.status,
    mustChangePassword: user.mustChangePassword === true,
    scope,
  };
}

// ── POST /api/auth/login ────────────────────────────────────────────
app.http('auth-login', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/login',
  handler: withCorrelation(async (request, context) => {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(400, { success: false, error: { code: 'INVALID_BODY', message: 'Invalid JSON body' } });
    }

    const email = normalizeEmail(body?.email);
    const password = String(body?.password || '');

    if (!email || !password) {
      return jsonResponse(400, { success: false, error: { code: 'MISSING_FIELDS', message: 'email y password son requeridos' } });
    }

    // Rate-limit by client IP + email so one attacker cannot brute-force a
    // single account nor spray every account from one IP.
    const rateKey = `${clientIp(request)}:${email}`;
    const rate = loginLimiter.check(rateKey, 'login');
    if (!rate.allowed) {
      context?.log?.('[Auth] Login rate-limited.');
      return authError(429, 'TOO_MANY_ATTEMPTS', 'Demasiados intentos de inicio de sesión. Intentá de nuevo en unos minutos.');
    }

    const user = await getUserByEmailWithPassword(email);
    // Fail closed without revealing existence: unknown email and wrong password
    // produce the same 401 INVALID_CREDENTIALS.
    if (!user || !verifyPassword(password, user.passwordHash)) {
      context?.log?.('[Auth] Login failed: invalid credentials (generic).');
      return authError(401, 'INVALID_CREDENTIALS', 'Credenciales inválidas. Verificá tu email y contraseña.');
    }

    if (user.status !== 'active') {
      context?.log?.(`[Auth] Login denied: userId=${user.userId} disabled.`);
      return authError(403, 'ACCESS_DENIED', 'Tu cuenta está deshabilitada. Contactá a administración.');
    }

    const session = await createSession(user.userId);
    const scope = await resolveScopeForUser(user.userId);
    context?.log?.(`[Auth] Login OK: userId=${user.userId}, role=${user.role}`);

    return jsonResponse(200, {
      success: true,
      token: session.token,
      expiresAt: session.expiresAt,
      user: publicUser(user, scope),
    });
  }),
});

// ── POST /api/auth/logout ───────────────────────────────────────────
app.http('auth-logout', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/logout',
  handler: withCorrelation(async (request, context) => {
    const token = extractBearerToken(request);
    if (token) {
      await deleteSession(token);
      context?.log?.('[Auth] Session revoked.');
    }
    return jsonResponse(200, { success: true });
  }),
});

// ── GET /api/auth/me ────────────────────────────────────────────────
app.http('auth-me', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'auth/me',
  handler: withCorrelation(withAuth(async (request, context) => {
    const user = context.user;
    if (!user || !user.id) {
      return authError(401, 'AUTH_REQUIRED', 'Se requiere autenticación para acceder a este recurso.');
    }
    const appUser = await getUserById(user.id);
    if (!appUser) {
      return authError(401, 'AUTH_REQUIRED', 'Se requiere autenticación para acceder a este recurso.');
    }
    return jsonResponse(200, {
      success: true,
      data: publicUser(appUser, await resolveScopeForUser(appUser.userId)),
    });
  })),
});

// ── POST /api/auth/change-password ──────────────────────────────────
app.http('auth-change-password', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/change-password',
  handler: withCorrelation(withAuth(async (request, context) => {
    const user = context.user;
    if (!user || !user.id) {
      return authError(401, 'AUTH_REQUIRED', 'Se requiere autenticación para acceder a este recurso.');
    }

    const token = extractBearerToken(request);
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(400, { success: false, error: { code: 'INVALID_BODY', message: 'Invalid JSON body' } });
    }

    const currentPassword = String(body?.currentPassword || '');
    const newPassword = String(body?.newPassword || '');

    if (!currentPassword || !newPassword) {
      return jsonResponse(400, { success: false, error: { code: 'MISSING_FIELDS', message: 'currentPassword y newPassword son requeridos' } });
    }
    if (newPassword.length < 8) {
      return jsonResponse(400, { success: false, error: { code: 'WEAK_PASSWORD', message: 'La contraseña debe tener al menos 8 caracteres.' } });
    }

    const appUser = await getUserById(user.id);
    if (!appUser || !verifyPassword(currentPassword, appUser.passwordHash)) {
      context?.log?.('[Auth] Change-password denied: invalid current password.');
      return authError(401, 'INVALID_CURRENT_PASSWORD', 'La contraseña actual es incorrecta.');
    }

    const updated = await setUserPassword(appUser.userId, newPassword, { mustChangePassword: false });
    if (!updated) {
      return jsonResponse(500, { success: false, error: { code: 'INTERNAL_ERROR', message: 'No se pudo actualizar la contraseña.' } });
    }

    // Security: revoke every OTHER session so a leaked password stops working.
    await deleteSessionsForUser(appUser.userId, token);
    context?.log?.('[Auth] Password changed; other sessions revoked.');
    return jsonResponse(200, { success: true });
  })),
});
