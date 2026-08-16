/* ============================================================
   API error feedback — maps structured server errors (status +
   `code`/`errorCategory`) to actionable, code-specific messages so
   surfaces never fall back to a generic "no disponible" (Story 10.24).
   ============================================================ */

const HARD_AUTH_CODES = new Set([
  'ACCESS_DENIED',
  'FORBIDDEN',
  'ENROLLMENT_INACTIVE',
  'ENROLLMENT_CHECK_FAILED',
  'AUTH_REQUIRED',
  'NOTIFICATION_SCOPE',
  'FRONTDOOR_INVALID',
  'INVALID_TOKEN',
  'TOKEN_EXPIRED',
]);

/**
 * @param {Error} err  Error carrying `status` and `code` (see parseApiError).
 * @param {{auth?: string, FORBIDDEN?: string, ACCESS_DENIED?: string, ENROLLMENT_INACTIVE?: string, other?: string}} hints
 * @returns {{kind: 'auth'|'transient'|'unknown', title: string, message: string, hint: string, retryable: boolean}}
 */
export function apiErrorFeedback(err, hints = {}) {
  const status = Number(err?.status) || 0;
  const code = err?.code;
  const message = err?.message || '';

  const isHardAuth = status === 401 || status === 403 || HARD_AUTH_CODES.has(code);
  if (isHardAuth) {
    const hint = hints[code] || hints.auth || 'Contactá a administración si creés que es un error.';
    return {
      kind: 'auth',
      title: 'No autorizado',
      message: message || 'Tu cuenta no tiene permisos para acceder a este recurso.',
      hint,
      retryable: false,
    };
  }

  if (status >= 500 || status === 0) {
    return {
      kind: 'transient',
      title: 'Servicio temporalmente no disponible',
      message: message || 'El backend no respondió.',
      hint: 'Intentá de nuevo en unos minutos.',
      retryable: true,
    };
  }

  return {
    kind: 'unknown',
    title: 'No se pudo cargar',
    message,
    hint: hints.other || '',
    retryable: status >= 500,
  };
}