/* ============================================================
   Upload drafts — estado persistente de las cargas en curso (#392)
   El estado del alta no puede vivir sólo en la memoria de la pestaña: mientras
   una pieza viaja al servidor queda un borrador en localStorage, así un refresco
   a mitad de camino no borra la evidencia del trabajo en curso ni deja la
   operación abandonada en silencio.
   ============================================================ */
const STORAGE_KEY = 'uade.upload.drafts';
const DRAFT_TTL_MS = 30 * 60 * 1000;

// Identifica la carga de página actual. Un borrador con otro loadId quedó
// huérfano de una pestaña anterior (refresco, cierre, pestaña cerrada): es una
// carga interrumpida, no una carga en curso.
export const LOAD_ID = `load-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const hasWindow = typeof window !== 'undefined';

function readAll() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        const now = Date.now();
        return parsed.filter((draft) => draft
            && typeof draft.filename === 'string'
            && draft.startedAt
            && (now - new Date(draft.startedAt).getTime()) < DRAFT_TTL_MS);
    } catch (_) {
        return [];
    }
}

function writeAll(list) {
    try {
        if (!list.length) localStorage.removeItem(STORAGE_KEY);
        else localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (_) {
        // Modo privado o cuota llena: la carga sigue, sólo se pierde el aviso.
    }
}

function samePieza(draft, pieza) {
    if (!draft || !pieza) return false;
    const size = (value) => (value === null || value === undefined ? null : value);
    return draft.filename === pieza.filename
        && draft.type === pieza.type
        && (draft.subjectId || null) === (pieza.subjectId || null)
        && size(draft.size) === size(pieza.size);
}

/* ── Aviso al salir con una carga en vuelo ─────────────────── */
let beforeUnloadArmed = false;

function onBeforeUnload(event) {
    if (!readAll().some((draft) => draft.status === 'uploading' && draft.loadId === LOAD_ID)) return undefined;
    event.preventDefault();
    event.returnValue = 'Hay una carga en curso: si salís ahora el material no se va a crear.';
    return event.returnValue;
}

function syncBeforeUnload() {
    if (!hasWindow) return;
    const inFlight = readAll().some((draft) => draft.status === 'uploading' && draft.loadId === LOAD_ID);
    if (inFlight && !beforeUnloadArmed) {
        beforeUnloadArmed = true;
        window.addEventListener('beforeunload', onBeforeUnload);
    } else if (!inFlight && beforeUnloadArmed) {
        beforeUnloadArmed = false;
        window.removeEventListener('beforeunload', onBeforeUnload);
    }
}

export const uploadDrafts = {
    loadId: LOAD_ID,

    // Registra la pieza apenas empieza a viajar al servidor.
    begin(pieza) {
        if (!pieza || !pieza.filename) return;
        const all = readAll().filter((draft) => !samePieza(draft, pieza));
        all.push({
            subjectId: pieza.subjectId || null,
            type: pieza.type || null,
            filename: pieza.filename,
            size: pieza.size === undefined ? null : pieza.size,
            status: 'uploading',
            loadId: LOAD_ID,
            startedAt: new Date().toISOString(),
        });
        writeAll(all);
        syncBeforeUnload();
    },

    // El POST ya volvió con material creado: la pieza sigue viva en el servidor
    // (la procesa processingNotifications), así que el borrador deja de hacer falta.
    clear(pieza) {
        if (!pieza) return;
        writeAll(readAll().filter((draft) => !samePieza(draft, pieza)));
        syncBeforeUnload();
    },

    // Cargas que quedaron a medias en una carga de página anterior.
    interrupted({ subjectId, type } = {}) {
        return readAll().filter((draft) => draft.status === 'uploading'
            && draft.loadId !== LOAD_ID
            && (!subjectId || draft.subjectId === subjectId)
            && (!type || draft.type === type));
    },

    // Cargas que todavía están viajando en esta pestaña.
    inFlight() {
        return readAll().filter((draft) => draft.status === 'uploading' && draft.loadId === LOAD_ID);
    },

    discard(pieza) {
        if (!pieza) return;
        writeAll(readAll().filter((draft) => !samePieza(draft, pieza)));
        syncBeforeUnload();
    },

    discardAll({ subjectId, type } = {}) {
        writeAll(readAll().filter((draft) => !(draft.status === 'uploading'
            && draft.loadId !== LOAD_ID
            && (!subjectId || draft.subjectId === subjectId)
            && (!type || draft.type === type))));
        syncBeforeUnload();
    },
};
