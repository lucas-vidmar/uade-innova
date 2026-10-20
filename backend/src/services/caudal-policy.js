/**
 * services/caudal-policy.js — política de caudal del servicio (#458, UJ-61)
 *
 * #570 dejó el conteo en un almacén compartido y la clave por persona, pero un
 * tope por identidad no acota el caudal del servicio: N personas × su tope = N
 * × tope. En la víspera de la evaluación "todos consultan a la vez", así que
 * hacen falta los dos ejes juntos:
 *
 *   1. por identidad  → ninguna persona se lleva más de lo suyo (tiers).
 *   2. por servicio   → el agregado de todas las identidades tiene techo.
 *
 * Sobre el techo de servicio se aparta una **reserva** para lo esencial
 * (consulta de material y entrega de documentos): el caudal que consume modelo
 * no puede comerse esa porción, de modo que un pico del asistente no deje a
 * nadie sin poder abrir el material ni bajarse el documento.
 *
 * Este módulo sólo clasifica y calcula; quién cuenta y dónde vive en
 * `rate-limiter.js`, y la composición de la decisión en `with-rate-limit.js`.
 */
import { CONFIG } from './config.js';

export const CAUDAL_CLASS = {
    /** Consume modelo y es el que hace pico en la víspera. */
    INTERACTIVE: 'interactive',
    /** Lectura de material y entrega de documentos: la reserva lo protege. */
    ESSENTIAL: 'essential',
};

/**
 * Motivos de denegación. Van al 429, al registro y al aviso, para que quien
 * opera pueda distinguir "esta persona se pasó" de "el servicio se quedó sin
 * caudal" y de "la reserva se agotó".
 */
export const CAUDAL_REASON = {
    IDENTITY_CAP: 'IDENTITY_CAP',
    SERVICE_CAP: 'SERVICE_CAP',
    RESERVE_EXHAUSTED: 'RESERVE_EXHAUSTED',
};

/**
 * Lo esencial, por ruta y método. El criterio es el del issue: lo que la persona
 * necesita para **consultar el material** y **recibir el documento**, y que no
 * gasta cuota de modelo (la capacidad escasa que el pico del asistente agota).
 *
 *   - `material-download`      → entrega del documento (GET).
 *   - `material-status[/…]`    → estado de procesado del material (GET).
 *   - `materials/{id}`         → metadatos del material (GET).
 *   - `classes[/{subjectId}]`  → la pantalla desde donde se llega al material (GET).
 *
 * El asistente (`rag-query`) queda del lado interactivo a propósito: es el que
 * produce el pico y el que consume modelo. Su reserva no lo cubre; su tope por
 * persona sí lo acota.
 */
const ESSENTIAL_ROUTES = [
    { method: 'GET', pattern: /^material-download\/?$/ },
    { method: 'GET', pattern: /^material-status(\/.*)?$/ },
    // El frontend pide el estado de varios materiales por POST batch: es la
    // misma consulta que el GET, y es la que dispara la pantalla del material.
    { method: 'POST', pattern: /^material-status\/batch\/?$/ },
    { method: 'GET', pattern: /^materials\/[^/]+\/?$/ },
    { method: 'GET', pattern: /^classes(\/[^/]+)?\/?$/ },
];

/**
 * Ruta lógica del pedido, sin host ni prefijo `/api`. Es la misma cadena que
 * el registro y el aviso muestran, para que se pueda leer qué endpoint frenó.
 */
export function routeOf(request) {
    const raw = String(request?.url || '');
    let pathname = raw;
    try {
        pathname = new URL(raw, 'http://localhost').pathname;
    } catch {
        pathname = raw.split('?')[0];
    }
    return pathname.replace(/^\/+/, '').replace(/^api\/+/, '').replace(/\/+$/, '');
}

/**
 * Clase de caudal del pedido. `options.class` permite fijarla en el wiring
 * (por ejemplo un endpoint que no se puede clasificar por URL); si no, manda
 * la tabla de arriba.
 */
export function classifyCaudal(request, options = {}) {
    if (options.class === CAUDAL_CLASS.ESSENTIAL || options.class === CAUDAL_CLASS.INTERACTIVE) {
        return options.class;
    }
    const route = options.route ?? routeOf(request);
    const method = String(request?.method || 'GET').toUpperCase();
    const essential = ESSENTIAL_ROUTES.some((entry) => entry.method === method && entry.pattern.test(route));
    return essential ? CAUDAL_CLASS.ESSENTIAL : CAUDAL_CLASS.INTERACTIVE;
}

export function essentialRoutes() {
    return ESSENTIAL_ROUTES.map((entry) => ({
        method: entry.method,
        pattern: entry.pattern.source,
    }));
}

/**
 * Techos de caudal del servicio, derivados de un solo número (el total por
 * ventana) y del porcentaje reservado: el operador mueve dos perillas y no
 * puede dejar la reserva y el total en contradicción.
 */
export function serviceCaps(overrides = {}) {
    const total = Number(overrides.totalPerWindow ?? CONFIG.rateLimit.service?.totalPerWindow) || 600;
    const reservePctRaw = Number(overrides.reservePct ?? CONFIG.rateLimit.service?.reservePct);
    const reservePct = Number.isFinite(reservePctRaw) ? Math.min(90, Math.max(0, reservePctRaw)) : 25;
    const essential = Math.round((total * reservePct) / 100);
    return {
        total,
        reservePct,
        essential,
        interactive: Math.max(0, total - essential),
    };
}

export function alertThresholdPct(overrides = {}) {
    const value = Number(overrides.alertThresholdPct ?? CONFIG.rateLimit.service?.alertThresholdPct);
    if (!Number.isFinite(value) || value <= 0) return 80;
    return Math.min(100, value);
}

/**
 * Tier con el que se cuenta el caudal de cada clase: la clave del contador
 * compartido de servicio es `service` y el tier distingue la clase, así una
 * misma entidad (`service:interactive`) suma a todas las identidades juntas.
 */
export function serviceTierOf(caudalClass) {
    return caudalClass === CAUDAL_CLASS.ESSENTIAL ? CAUDAL_CLASS.ESSENTIAL : CAUDAL_CLASS.INTERACTIVE;
}

/**
 * Tier del tope por identidad. Lo esencial tiene el suyo propio y holgado; el
 * resto de las rutas usa el tier con el que se las declaró (chat, ingest,
 * general).
 */
export function identityTierOf(caudalClass, declaredTier) {
    return caudalClass === CAUDAL_CLASS.ESSENTIAL ? 'essential' : (declaredTier || 'general');
}
