/**
 * middleware/with-access-trace.js — Instrumentación del rastro de accesos
 * (UJ-62 pasos 5, 7, 8 y 9 / #456).
 *
 * `withCorrelation` envuelve **todas** las funciones HTTP del servicio (149
 * registros y contando), así que es el único punto que ve cada pedido con su
 * respuesta ya resuelta: ahí se decide qué se asienta. Este módulo sólo
 * traduce pedido+respuesta a un asiento del `access-audit-store` y garantiza
 * que el rastro nunca tumbe ni retrase de forma indefinida un pedido real.
 *
 * Qué se guarda y qué no:
 *  - Superficie (`context.functionName`), método, ruta sin query string y los
 *    *nombres* de los parámetros de query. Los valores no se copian: pueden ser
 *    el dato buscado.
 *  - El cuerpo del pedido no se lee nunca (consumirlo rompería el handler y
 *    copiarlo llevaría contenido sensible al rastro).
 *  - Quién: identidad resuelta por `withAuth` (se lee del stash del request) o
 *    `anonymous` con `identified: false`. No se deduce nada más.
 *  - Desde dónde: sólo si la petición trae cabecera de origen. Si no, queda
 *    `available: false` — no se inventa una IP.
 *  - Resultado: `delivered` (2xx/3xx), `denied` (401/403/429/451) o `error`
 *    (resto). Es la separación que el paso 8 pide para el auditor.
 *
 * Sin imports estáticos de `storage.js` ni de `auth-utils.js`: decenas de
 * pruebas de funciones mockean esos módulos con superficies parciales, y un
 * import estático acá haría fallar la instanciación de *todo* módulo envuelto
 * en `withCorrelation` (el mismo motivo por el que `with-auth.js` los importa
 * dentro de la función).
 */

/** Códigos con los que el servicio no entrega datos, con su familia. */
const DENIED_STATUSES = new Map([
  [401, 'auth'],
  [403, 'permission'],
  [429, 'rate-limit'],
  [451, 'legal'],
]);

export const TRACE_TIMEOUT_MS = (() => {
  const raw = Number(process.env.ACCESS_AUDIT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1500;
})();

function flagEnabled(name, defaultValue = true) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  return String(raw).toLowerCase() !== 'false';
}

export function isAuditTrailEnabled() {
  return flagEnabled('ACCESS_AUDIT_ENABLED', true);
}

export function classifyOutcome(status) {
  const code = Number(status);
  if (!Number.isFinite(code)) return 'error';
  if (code >= 200 && code < 400) return 'delivered';
  if (DENIED_STATUSES.has(code)) return 'denied';
  return 'error';
}

export function denyKind(status) {
  return DENIED_STATUSES.get(Number(status)) || null;
}

/**
 * Código de error de la respuesta (`{ code }` del cuerpo estructurado), sin
 * copiar el mensaje: el asiento necesita el motivo, no el texto.
 */
export function extractDenialCode(response) {
  const body = response?.body;
  if (typeof body !== 'string' || !body.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(body);
    const code = parsed?.code || parsed?.error?.code;
    return typeof code === 'string' && code.length <= 64 ? code : null;
  } catch {
    return null;
  }
}

function firstSegmentAfterApi(pathname) {
  const match = /^\/(?:api\/)?([^/]+)/.exec(pathname || '');
  return match ? match[1] : null;
}

/**
 * Describe el pedido sin copiar su contenido.
 * @param {Object} request Azure Functions HttpRequest
 * @param {Object} [context]
 */
export function describeRequest(request, context) {
  let pathname = null;
  let queryKeys = [];
  const rawUrl = typeof request?.url === 'string' ? request.url : '';
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl, 'http://local');
      pathname = parsed.pathname;
      queryKeys = [...new Set([...parsed.searchParams.keys()])].slice(0, 20);
    } catch {
      pathname = rawUrl.split('?')[0] || null;
    }
  }
  if (!pathname) {
    // Handlers de prueba o invocaciones sin url: se guarda lo que haya.
    const params = request?.params || {};
    const tail = Object.values(params).filter((v) => typeof v === 'string' && v).join('/');
    pathname = tail ? `/api/${tail}` : null;
  }
  return {
    method: request?.method || null,
    path: pathname,
    resource: firstSegmentAfterApi(pathname),
    queryKeys,
  };
}

/**
 * Origen del pedido tal como lo informa la plataforma, o declarado ausente.
 * @param {Object} request
 */
export function describeOrigin(request) {
  const read = (name) => request?.headers?.get?.(name) || null;
  const azureIp = read('x-azure-clientip');
  if (azureIp) {
    return { ip: String(azureIp).trim().slice(0, 64), source: 'x-azure-clientip', available: true, nota: null };
  }
  const forwarded = read('x-forwarded-for');
  if (forwarded) {
    const first = String(forwarded).split(',')[0].trim();
    if (first) {
      return { ip: first.slice(0, 64), source: 'x-forwarded-for', available: true, nota: null };
    }
  }
  return {
    ip: null,
    source: null,
    available: false,
    nota: 'origen no disponible: la petición no trajo x-azure-clientip ni x-forwarded-for',
  };
}

let authUtilsCache = null;
async function loadAuthUtils() {
  if (authUtilsCache) return authUtilsCache;
  const mod = await import('../services/auth-utils.js');
  authUtilsCache = mod;
  return mod;
}

let storeCache = null;
async function loadStore() {
  if (storeCache) return storeCache;
  const mod = await import('../services/access-audit-store.js');
  storeCache = mod;
  return mod;
}

/** Identidad ya validada por withAuth, o anónimo declarado como tal. */
export async function describeActor(request) {
  const anonymous = { id: 'anonymous', role: null, identified: false };
  try {
    const mod = await loadAuthUtils();
    const getStashed = mod?.getStashedIdentity;
    if (typeof getStashed !== 'function') return anonymous;
    const stashed = getStashed(request);
    const user = stashed?.user || null;
    if (!user?.userId) return anonymous;
    return {
      id: String(user.sanitizedId || user.userId).slice(0, 128),
      role: user.role || null,
      identified: true,
    };
  } catch {
    return anonymous;
  }
}

export function shouldTrace(request) {
  if (!isAuditTrailEnabled()) return false;
  const method = String(request?.method || '').toUpperCase();
  // El preflight no pide datos y lo resuelve el propio withCorrelation.
  if (method === 'OPTIONS') return false;
  return true;
}

/**
 * Construye el asiento de un pedido.
 * @returns {Object} entrada lista para `recordAccess`
 */
export function buildAccessEntry({ request, context, response, startedAt, thrown, actor }) {
  const status = thrown ? 500 : Number(response?.status);
  const outcome = classifyOutcome(status);
  const entry = {
    at: new Date().toISOString(),
    correlationId: context?.correlationId || null,
    surface: context?.functionName || context?.executionContext?.functionName || null,
    request: describeRequest(request),
    actor: actor || { id: 'anonymous', role: null, identified: false },
    outcome,
    status: Number.isFinite(status) ? status : null,
    denial: outcome === 'denied' ? { code: extractDenialCode(response), kind: denyKind(status) } : null,
    origin: describeOrigin(request),
    durationMs: Number.isFinite(startedAt) ? Date.now() - startedAt : null,
  };
  return entry;
}

/**
 * Asienta el pedido. Nunca lanza y nunca deja el pedido sin respuesta: si el
 * almacén no contesta en `TRACE_TIMEOUT_MS`, se sigue y se declara el fallo.
 * @returns {Promise<{recorded: boolean, recordId: string|null, error?: string}>}
 */
export async function traceAccess({ request, context, response, startedAt, thrown } = {}) {
  if (!shouldTrace(request)) return { recorded: false, recordId: null, error: 'no trazado' };
  let timer = null;
  try {
    const store = await loadStore();
    if (typeof store.isAuditStorageConfigured === 'function' && !store.isAuditStorageConfigured()) {
      return { recorded: false, recordId: null, error: 'sin almacén de auditoría configurado' };
    }
    const actor = await describeActor(request);
    const entry = buildAccessEntry({ request, context, response, startedAt, thrown, actor });
    const result = await Promise.race([
      store.recordAccess(entry),
      new Promise((resolve) => {
        timer = setTimeout(
          () => resolve({ recorded: false, recordId: null, error: 'tiempo de escritura del rastro agotado' }),
          TRACE_TIMEOUT_MS
        );
        if (typeof timer?.unref === 'function') timer.unref();
      }),
    ]);
    return result;
  } catch (err) {
    return { recorded: false, recordId: null, error: err?.message || 'no se pudo asentar el pedido' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
