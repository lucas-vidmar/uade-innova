/* ============================================================
   Processing Notifications Service — Global polling + toasts
   ============================================================ */
import { api } from './api.js';
import { auth } from './auth.js';
import { toast } from '../components/Toast.js';

const STORAGE_KEY = 'uade.processing.tracked-jobs';
const POLL_INTERVAL_MS = Number(globalThis?.__UADE_PROCESSING_POLL_MS) > 0
    ? Number(globalThis.__UADE_PROCESSING_POLL_MS)
    : 8000;

let trackedJobs = loadTrackedJobs();
let timerId = null;
let isPolling = false;

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

async function pollStatuses() {
    if (isPolling || trackedJobs.length === 0) return;
    isPolling = true;

    try {
        const subjectIds = Array.from(new Set(trackedJobs.map((job) => job.subjectId).filter(Boolean)));
        const classesBySubject = new Map();

        for (const subjectId of subjectIds) {
            try {
                const classes = await api.getClasses(subjectId);
                classesBySubject.set(subjectId, Array.isArray(classes) ? classes : []);
            } catch (err) {
                console.error('[ProcessingNotifications] poll getClasses failed:', err);
                classesBySubject.set(subjectId, []);
            }
        }

        const pending = [];

        trackedJobs.forEach((job) => {
            const classes = classesBySubject.get(job.subjectId) || [];
            const terminal = resolveTerminalStatusForJob(job, classes);

            if (!terminal) {
                pending.push(job);
                return;
            }

            if (terminal === 'ready') {
                toast('success', 'Procesamiento completado', `"${job.filename}" ya está listo para usar.`);
                return;
            }

            toast('error', 'Procesamiento con error', `"${job.filename}" terminó con errores. Revisá el material e intentá nuevamente.`);
        });

        trackedJobs = pending;
        persistTrackedJobs();
        stopPollingIfIdle();
    } finally {
        isPolling = false;
    }
}

export const processingNotifications = {
    init() {
        trackedJobs = loadTrackedJobs();

        const activeSubjectId = auth.getActiveSubjectId();
        if (activeSubjectId) {
            trackedJobs = trackedJobs.filter((job) => !!job?.materialId && !!job?.subjectId);
            persistTrackedJobs();
        }

        if (trackedJobs.length > 0) {
            ensurePolling();
            pollStatuses();
        }
    },

    trackJob({ materialId, subjectId, classIds = [], filename = 'Material' }) {
        if (!materialId || !subjectId) return;

        trackedJobs = trackedJobs.filter((job) => job.materialId !== materialId || job.subjectId !== subjectId);

        trackedJobs.push({
            materialId,
            subjectId,
            classIds: normalizeClassIds(classIds),
            filename,
            trackedAt: new Date().toISOString(),
        });

        persistTrackedJobs();
        ensurePolling();
        pollStatuses();
    },
};
