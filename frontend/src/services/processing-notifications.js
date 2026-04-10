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
        const pending = [];

        for (const job of trackedJobs) {
            let terminal = null;
            let shouldFallbackToClasses = false;

            try {
                const statusResult = await api.getMaterialStatus(job.subjectId, job.materialId);
                const status = statusResult?.status;
                if (status === 'ready' || status === 'error') {
                    terminal = status;
                } else if (status !== 'processing') {
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

            if (terminal === 'ready') {
                toast('success', 'Procesamiento completado', `"${job.filename}" ya está listo para usar.`);
                continue;
            }

            toast('error', 'Procesamiento con error', `"${job.filename}" terminó con errores. Revisá el material e intentá nuevamente.`);
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
        const normalized = normalizeTrackedJob({ materialId, subjectId, classIds, filename });
        if (!normalized) return;

        trackedJobs = trackedJobs.filter((job) => job.materialId !== normalized.materialId || job.subjectId !== normalized.subjectId);

        trackedJobs.push(normalized);

        persistTrackedJobs();
        ensurePolling();
        pollStatuses();
    },
};
