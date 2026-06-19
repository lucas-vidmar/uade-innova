/* ============================================================
   Processing Notifications Service — Global polling + toasts
   ============================================================ */
import { api } from './api.js';
import { auth } from './auth.js';
import { toast } from '../components/Toast.js';

const STORAGE_KEY = 'uade.processing.tracked-jobs';
const BROADCAST_CHANNEL_NAME = 'uade-processing-sync';
const DEDUP_QUEUE_MAX = 100;
const SESSION_BROADCAST_KEY = 'uade.processing.seen-broadcasts';
const BROADCAST_KEY = 'uade.processing.last-broadcast';
const POLL_INTERVAL_MS = Number(globalThis?.__UADE_PROCESSING_POLL_MS) > 0
    ? Number(globalThis.__UADE_PROCESSING_POLL_MS)
    : 8000;
const JOB_TTL_MS = 30 * 60 * 1000;
const MAX_POLL_RETRIES = 225;

let trackedJobs = loadTrackedJobs();
let timerId = null;
let isPolling = false;
const listeners = new Set();

/* ── Cross-tab broadcast sync ──────────────────────────── */
let broadcastChannel = null;
let dedupQueue = new Set();
let broadcastCounter = 0;

function loadDedupQueue() {
    try {
        const stored = sessionStorage.getItem(SESSION_BROADCAST_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            return new Set(Array.isArray(parsed) ? parsed : []);
        }
    } catch (_) {}
    return new Set();
}

function persistDedupQueue() {
    try {
        sessionStorage.setItem(SESSION_BROADCAST_KEY, JSON.stringify([...dedupQueue]));
    } catch (_) {}
}

function trimDedupQueue() {
    if (dedupQueue.size > DEDUP_QUEUE_MAX) {
        const entries = [...dedupQueue];
        dedupQueue = new Set(entries.slice(-DEDUP_QUEUE_MAX));
    }
}

function generateBroadcastId() {
    return `bc-${++broadcastCounter}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function handleBroadcast(data) {
    if (!data || !data.broadcastId || !data.materialId) return;
    if (dedupQueue.has(data.broadcastId)) return;

    dedupQueue.add(data.broadcastId);
    trimDedupQueue();
    persistDedupQueue();

    const { materialId, subjectId, terminal, filename, classIds } = data;
    const idx = trackedJobs.findIndex(
        (j) => j.materialId === materialId && j.subjectId === subjectId
    );
    if (idx === -1) return;

    const [job] = trackedJobs.splice(idx, 1);

    const bufIdx = toastBuffer.findIndex(
        (j) => j.materialId === materialId && j.subjectId === subjectId
    );
    if (bufIdx !== -1) toastBuffer.splice(bufIdx, 1);

    persistTrackedJobs();

    notifyListeners({
        type: 'material-status-terminal',
        terminal,
        materialId,
        subjectId,
        classIds: Array.isArray(classIds) ? classIds : [...(job.classIds || [])],
        filename: filename || job.filename,
        source: 'cross-tab',
    });

    const displayFilename = filename || job.filename || 'Material';
    if (terminal === 'ready') {
        toast('success', 'Procesamiento completado', `"${displayFilename}" ya está listo para usar.`);
    } else {
        toast('error', 'Procesamiento con error', `"${displayFilename}" terminó con errores. Revisá el material e intentá nuevamente.`);
    }

    stopPollingIfIdle();
}

function handleStorageEvent(event) {
    if (event.key && event.key.startsWith(BROADCAST_KEY + '.') && event.newValue) {
        try {
            const data = JSON.parse(event.newValue);
            handleBroadcast(data);
        } catch (_) {}
    }
}

function broadcastTerminal(job, terminal) {
    const payload = {
        broadcastId: generateBroadcastId(),
        materialId: job.materialId,
        subjectId: job.subjectId,
        classIds: job.classIds || [],
        filename: job.filename || 'Material',
        terminal,
        timestamp: Date.now(),
    };

    const storageKey = `${BROADCAST_KEY}.${payload.broadcastId}`;
    try {
        localStorage.setItem(storageKey, JSON.stringify(payload));
        setTimeout(() => {
            try { localStorage.removeItem(storageKey); } catch (_) {}
        }, 5000);
    } catch (_) {}

    if (broadcastChannel) {
        broadcastChannel.postMessage(payload);
    }
}

let broadcastSyncInitialized = false;

function initBroadcastSync() {
    if (broadcastSyncInitialized) return;
    broadcastSyncInitialized = true;

    dedupQueue = loadDedupQueue();

    try {
        broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
        broadcastChannel.onmessage = (event) => {
            handleBroadcast(event.data);
        };
    } catch (_) {
        console.log('[ProcessingNotifications] BroadcastChannel not available, falling back to storage events');
    }

    window.addEventListener('storage', handleStorageEvent);
}

/* ── Toast deduplication buffer ─────────────────────────── */
let toastBuffer = [];
let flushTimeoutId = null;
const TOAST_FLUSH_DELAY_MS = 3000;

function flushToastBuffer() {
    if (toastBuffer.length === 0) return;

    const byStatus = { ready: [], error: [] };
    toastBuffer.forEach((job) => {
        const key = job.terminal === 'ready' || job.terminal === 'error' ? job.terminal : 'error';
        byStatus[key].push(job);
    });

    const bufferSnapshot = [...toastBuffer];
    toastBuffer = [];
    flushTimeoutId = null;

    Object.entries(byStatus).forEach(([status, jobs]) => {
        if (jobs.length === 0) return;
        try {
            if (jobs.length === 1) {
                const job = jobs[0];
                if (status === 'ready') {
                    toast('success', 'Procesamiento completado', `"${job.filename}" ya está listo para usar.`);
                } else {
                    const details = job.errorMessage ? ` Motivo: ${job.errorMessage}` : '';
                    console.error(`[ProcessingNotifications] Error en "${job.filename}":${details}`);
                    toast('error', 'Procesamiento con error', `"${job.filename}" terminó con errores.${details || ' Revisá el material e intentá nuevamente.'}`);
                }
            } else {
                const count = jobs.length;
                const filenames = jobs.map((j) => j.filename);
                const noun = 'materiales';
                if (status === 'ready') {
                    toast('success', `${count} ${noun} procesados correctamente`, '', 5000, filenames);
                } else {
                    const firstMsg = jobs.find(j => j.errorMessage)?.errorMessage;
                    const msg = firstMsg ? `Ejemplo: ${firstMsg}` : 'Revisá los materiales e intentá nuevamente.';
                    jobs.forEach(j => {
                        if (j.errorMessage) console.error(`[ProcessingNotifications] Error en "${j.filename}": ${j.errorMessage}`);
                    });
                    toast('error', `${count} ${noun} terminaron con errores`, msg, 5000, filenames);
                }
            }
        } catch (flushErr) {
            console.error('[ProcessingNotifications] flushToastBuffer toast() failed:', flushErr);
        }
    });
}

function scheduleFlush() {
    if (flushTimeoutId) clearTimeout(flushTimeoutId);
    flushTimeoutId = setTimeout(flushToastBuffer, TOAST_FLUSH_DELAY_MS);
}

const configuredBaseUrl = (typeof import.meta !== 'undefined' && import.meta.env)
    ? String(import.meta.env.VITE_API_BASE_URL || '').trim()
    : '';
const isLocalRuntime = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const isLocalApiUrl = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(configuredBaseUrl);
const MATERIAL_STATUS_BASE_URL = (!isLocalRuntime && isLocalApiUrl)
    ? '/api'
    : (configuredBaseUrl
        || (isLocalRuntime
            ? 'http://localhost:7071/api'
            : '/api'));

function loadTrackedJobs() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function persistTrackedJobs() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(trackedJobs));
    } catch {
        // Ignore private mode/quota errors
    }
}

function normalizeClassIds(classIds) {
    if (!Array.isArray(classIds)) return [];
    const unique = new Set(classIds.filter(Boolean));
    return Array.from(unique);
}

function normalizeTrackedJob(job) {
    if (!job || typeof job !== 'object') return null;

    const materialId = typeof job.materialId === 'string' ? job.materialId.trim() : '';
    const subjectId = typeof job.subjectId === 'string' ? job.subjectId.trim() : '';

    if (!materialId || !subjectId) return null;

    const filename = typeof job.filename === 'string' && job.filename.trim()
        ? job.filename.trim()
        : 'Material';

    return {
        materialId,
        subjectId,
        classIds: normalizeClassIds(job.classIds),
        filename,
        trackedAt: typeof job.trackedAt === 'string' && job.trackedAt.trim()
            ? job.trackedAt
            : new Date().toISOString(),
        pollCount: typeof job.pollCount === 'number' ? job.pollCount : 0,
    };
}

function normalizeTrackedJobs(jobs) {
    if (!Array.isArray(jobs)) return [];

    const dedupe = new Map();
    jobs.forEach((job) => {
        const normalized = normalizeTrackedJob(job);
        if (!normalized) return;
        dedupe.set(`${normalized.subjectId}::${normalized.materialId}`, normalized);
    });

    return Array.from(dedupe.values());
}

function hasJobExpired(job) {
    if (!job || !job.trackedAt) return true;
    const age = Date.now() - new Date(job.trackedAt).getTime();
    if (age > JOB_TTL_MS) return true;
    if ((job.pollCount || 0) >= MAX_POLL_RETRIES) return true;
    return false;
}

function ensurePolling() {
    if (timerId) return;
    timerId = setInterval(() => {
        pollStatuses();
    }, POLL_INTERVAL_MS);
}

function stopPollingIfIdle() {
    if (trackedJobs.length > 0) return;
    if (timerId) {
        clearInterval(timerId);
        timerId = null;
    }
}

function notifyListeners(event) {
    listeners.forEach((listener) => {
        try {
            listener(event);
        } catch (err) {
            console.error('[ProcessingNotifications] listener failed:', err);
        }
    });
}

function resolveTerminalStatusForJob(job, classes) {
    const classesList = Array.isArray(classes) ? classes : [];
    const matchingMaterials = [];

    classesList.forEach((cls) => {
        const clsId = cls?.id;
        if (job.classIds.length > 0 && clsId && !job.classIds.includes(clsId)) return;
        (cls?.materials || []).forEach((mat) => {
            if ((mat?.id || mat?.materialId) === job.materialId) {
                matchingMaterials.push(mat);
            }
        });
    });

    if (matchingMaterials.length === 0) return null;

    const hasError = matchingMaterials.some((mat) => mat?.status === 'error');
    if (hasError) return 'error';

    const hasReady = matchingMaterials.some((mat) => mat?.status === 'ready');
    if (hasReady) return 'ready';

    return null;
}

async function fetchMaterialStatusBatch(subjectId, materialIds) {
    if (typeof api.getMaterialStatusBatch === 'function') {
        return api.getMaterialStatusBatch(subjectId, materialIds);
    }

    const deduped = Array.from(new Set((Array.isArray(materialIds) ? materialIds : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)));

    if (!subjectId || deduped.length === 0) {
        return { subjectId, results: [] };
    }

    const params = new URLSearchParams({
        subjectId,
        materialIds: deduped.join(','),
    });

    const response = await fetch(`${MATERIAL_STATUS_BASE_URL}/material-status?${params.toString()}`);
    if (!response.ok) {
        throw new Error(`Error ${response.status}: material-status-batch`);
    }

    const body = await response.json();
    return {
        subjectId,
        results: Array.isArray(body?.results) ? body.results : [],
    };
}

async function pollStatuses() {
    if (isPolling || trackedJobs.length === 0) return;
    isPolling = true;

    try {
        const pending = [];

        const jobIndexesBySubject = new Map();
        trackedJobs.forEach((job, index) => {
            if (!jobIndexesBySubject.has(job.subjectId)) {
                jobIndexesBySubject.set(job.subjectId, []);
            }
            jobIndexesBySubject.get(job.subjectId).push(index);
        });

        const batchStatusByKey = new Map();
        for (const [subjectId, indexes] of jobIndexesBySubject.entries()) {
            const materialIds = indexes.map((index) => trackedJobs[index].materialId);
            try {
                const batch = await fetchMaterialStatusBatch(subjectId, materialIds);
                const results = Array.isArray(batch?.results) ? batch.results : [];
                results.forEach((result) => {
                    if (!result?.materialId) return;
                    batchStatusByKey.set(`${subjectId}::${result.materialId}`, result);
                });
            } catch (batchErr) {
                console.error('[ProcessingNotifications] poll getMaterialStatusBatch failed, fallback to per-item:', batchErr);
            }
        }

        let bufferWasUpdated = false;

        const jobsSnapshot = [...trackedJobs];
        for (const job of jobsSnapshot) {
            let terminal = null;
            let shouldFallbackToClasses = false;

            job.pollCount = (job.pollCount || 0) + 1;

            if (hasJobExpired(job)) {
                const displayFilename = job.filename || 'Material';
                toast('warning', 'Tiempo de espera agotado', `"${displayFilename}" está demorando más de lo esperado. Revisá el estado del material en la tabla o intentá la carga nuevamente.`, 8000);
                console.warn(`[ProcessingNotifications] Job expired for "${displayFilename}" (trackedAt=${job.trackedAt}, pollCount=${job.pollCount})`);
                const expiredIndex = trackedJobs.findIndex(
                    (j) => j.materialId === job.materialId && j.subjectId === job.subjectId
                );
                if (expiredIndex !== -1) {
                    trackedJobs.splice(expiredIndex, 1);
                }
                notifyListeners({
                    type: 'material-status-terminal',
                    terminal: 'expired',
                    materialId: job.materialId,
                    subjectId: job.subjectId,
                    classIds: [...(job.classIds || [])],
                    filename: job.filename,
                });
                continue;
            }

            try {
                const batchResult = batchStatusByKey.get(`${job.subjectId}::${job.materialId}`);
                const statusResult = batchResult?.material || null;
                const status = statusResult?.status;
                if (status === 'ready' || status === 'error') {
                    terminal = status;
                } else if (status === 'pending' || status === 'processing') {
                    // keep waiting
                } else if (batchResult?.found === false && batchResult?.httpStatus === 404) {
                    shouldFallbackToClasses = true;
                } else if (!batchResult) {
                    const singleStatusResult = await api.getMaterialStatus(job.subjectId, job.materialId);
                    const singleStatus = singleStatusResult?.status;
                    if (singleStatus === 'ready' || singleStatus === 'error') {
                        terminal = singleStatus;
                    } else if (singleStatus !== 'pending' && singleStatus !== 'processing') {
                        shouldFallbackToClasses = true;
                    }
                } else {
                    shouldFallbackToClasses = true;
                }
            } catch (statusErr) {
                console.error('[ProcessingNotifications] poll getMaterialStatus failed, fallback to classes:', statusErr);
                shouldFallbackToClasses = true;
            }

            if (!terminal && shouldFallbackToClasses) {
                try {
                    const classes = await api.getClasses(job.subjectId);
                    terminal = resolveTerminalStatusForJob(job, Array.isArray(classes) ? classes : []);
                } catch (err) {
                    console.error('[ProcessingNotifications] poll getClasses failed:', err);
                }
            }

            if (!terminal) {
                pending.push(job);
                continue;
            }

            if (terminal === 'ready' || terminal === 'error') {
                toastBuffer.push({ ...job, terminal });
                bufferWasUpdated = true;
                notifyListeners({
                    type: 'material-status-terminal',
                    terminal,
                    materialId: job.materialId,
                    subjectId: job.subjectId,
                    classIds: [...job.classIds],
                    filename: job.filename,
                });
                broadcastTerminal(job, terminal);
            }
        }

        if (bufferWasUpdated) {
            scheduleFlush();
        }

        trackedJobs = pending;
        persistTrackedJobs();
        stopPollingIfIdle();
    } finally {
        isPolling = false;
    }
}

export const processingNotifications = {
    init() {
        trackedJobs = normalizeTrackedJobs(loadTrackedJobs());
        initBroadcastSync();

        const activeSubjectId = auth.getActiveSubjectId();
        if (activeSubjectId) {
            trackedJobs = trackedJobs.filter((job) => !!job?.materialId && !!job?.subjectId);
        }

        const beforeCleanup = trackedJobs.length;
        trackedJobs = trackedJobs.filter((job) => !hasJobExpired(job));
        if (trackedJobs.length !== beforeCleanup) {
            console.warn(`[ProcessingNotifications] Cleaned ${beforeCleanup - trackedJobs.length} expired job(s) on init`);
            persistTrackedJobs();
        }

        if (trackedJobs.length > 0) {
            ensurePolling();
            pollStatuses();
        }
    },

    trackJob({ materialId, subjectId, classIds = [], filename = 'Material' }) {
        const normalized = normalizeTrackedJob({ materialId, subjectId, classIds, filename });
        if (!normalized) return;

        trackedJobs = trackedJobs.filter((job) => job.materialId !== normalized.materialId || job.subjectId !== normalized.subjectId);

        trackedJobs.push(normalized);

        persistTrackedJobs();
        ensurePolling();
        pollStatuses();
    },

    subscribe(listener) {
        if (typeof listener !== 'function') {
            return () => { };
        }

        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    },
};
