import {
    USE_MOCK, BASE_URL, apiFetch, fetchWithTimeout, delay, readLocalJson, writeLocalJson,
    LOCAL_SUBJECTS_KEY, LOCAL_CLASSES_KEY
} from './core.js';

function getLocalSubjects() {
    const subjects = readLocalJson(LOCAL_SUBJECTS_KEY, []);
    return Array.isArray(subjects) ? subjects : [];
}

function setLocalSubjects(subjects) {
    writeLocalJson(LOCAL_SUBJECTS_KEY, Array.isArray(subjects) ? subjects : []);
}

function upsertLocalSubject(subject) {
    const localSubjects = getLocalSubjects();
    const next = [...localSubjects];
    const idx = next.findIndex((item) => item.id === subject.id);
    if (idx >= 0) {
        next[idx] = { ...next[idx], ...subject };
    } else {
        next.push(subject);
    }
    setLocalSubjects(next);
}

function removeLocalSubject(subjectId) {
    const localSubjects = getLocalSubjects().filter((item) => item.id !== subjectId);
    setLocalSubjects(localSubjects);

    const classesBySubject = readLocalJson(LOCAL_CLASSES_KEY, {});
    if (classesBySubject && typeof classesBySubject === 'object') {
        delete classesBySubject[subjectId];
        writeLocalJson(LOCAL_CLASSES_KEY, classesBySubject);
    }
}

function mergeSubjectsWithLocal(defaultSubjects) {
    const base = Array.isArray(defaultSubjects) ? defaultSubjects : [];
    const local = getLocalSubjects();
    const map = new Map();

    base.forEach((subject) => {
        if (subject?.id) map.set(subject.id, subject);
    });
    local.forEach((subject) => {
        if (subject?.id) map.set(subject.id, { ...(map.get(subject.id) || {}), ...subject });
    });

    return Array.from(map.values());
}

function seedDemoData() {
    const demoSubjects = [
        { id: 'arq-soft-2026', name: 'Arquitectura de Software 2026', track: 'Tecnicatura', professors: ['Dr. García'] },
        { id: 'ing-datos-2026', name: 'Ingeniería de Datos 2026', track: 'Tecnicatura', professors: ['Ing. López'] },
    ];
    setLocalSubjects(demoSubjects);
    const now = new Date();
    const demoClasses = [
        { id: 'class-01', title: 'Clase 1 - Introducción', date: new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0], topics: ['Fundamentos', 'Historia'], materials: [] },
        { id: 'class-02', title: 'Clase 2 - Patrones de Diseño', date: new Date(now.getTime() - 3 * 86400000).toISOString().split('T')[0], topics: ['Patrones GoF', 'Arquitectura'], materials: [] },
        { id: 'class-03', title: 'Clase 3 - Hexagonal', date: now.toISOString().split('T')[0], topics: ['Puertos y Adaptadores', 'Dominio'], materials: [] },
    ];
    demoSubjects.forEach(s => {
        const classesBySubject = readLocalJson(LOCAL_CLASSES_KEY, {});
        const safeMap = classesBySubject && typeof classesBySubject === 'object' ? classesBySubject : {};
        safeMap[s.id] = demoClasses;
        writeLocalJson(LOCAL_CLASSES_KEY, safeMap);
    });
}

export { mergeSubjectsWithLocal };

export async function getSubjects() {
    if (USE_MOCK) {
        await delay(400);
        const existing = getLocalSubjects();
        if (existing.length === 0) {
            seedDemoData();
        }
        return mergeSubjectsWithLocal([]);
    }
    try {
        const res = await apiFetch(`${BASE_URL}/subjects`);
        if (!res.ok) {
            return mergeSubjectsWithLocal([]);
        }
        const data = await res.json();
        const subjects = Array.isArray(data) ? data : [];
        return mergeSubjectsWithLocal(subjects);
    } catch (err) {
        console.error('[API] getSubjects failed:', err);
        return mergeSubjectsWithLocal([]);
    }
}

export async function saveSubject(subject) {
    if (USE_MOCK) {
        await delay(250);
        const mockSubject = {
            ...subject,
            id: subject.id || `subject-${Date.now()}`,
            name: subject.name || 'Nueva Materia'
        };
        upsertLocalSubject(mockSubject);
        return mockSubject;
    }

    const method = subject?.id ? 'PUT' : 'POST';
    try {
        const res = await apiFetch(`${BASE_URL}/subjects`, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(subject),
        });

        if (!res.ok) {
            let message = `Error ${res.status}: No se pudo guardar la materia`;
            try {
                const err = await res.json();
                if (err?.error) message = err.error;
            } catch {
                // no-op
            }

            if (res.status >= 500 || res.status === 404) {
                const fallbackSubject = {
                    id: subject.id || `subject-${Date.now()}`,
                    name: subject.name,
                    oneLiner: subject.oneLiner || '',
                    comment: subject.comment || subject.oneLiner || '',
                };
                upsertLocalSubject(fallbackSubject);
                return fallbackSubject;
            }

            throw new Error(message);
        }

        const data = await res.json();
        if (data?.id) upsertLocalSubject({ ...subject, ...data });
        return data;
    } catch (err) {
        console.error('[API] saveSubject failed:', err);
        throw err;
    }
}

export async function deleteSubject(subjectId, cascade = false) {
    if (USE_MOCK) {
        await delay(250);
        return { success: true };
    }

    try {
        const url = new URL(`${BASE_URL}/subjects/${encodeURIComponent(subjectId)}`);
        if (cascade) url.searchParams.set('cascade', 'true');

        const res = await apiFetch(url.toString(), {
            method: 'DELETE',
        });

        if (!res.ok) {
            if (res.status === 404) {
                removeLocalSubject(subjectId);
            }

            let message = `Error ${res.status}: No se pudo eliminar la materia`;
            try {
                const err = await res.json();
                if (err?.error) message = err.error;
            } catch {
                // no-op
            }
            throw new Error(message);
        }

        removeLocalSubject(subjectId);
        return res.json();
    } catch (err) {
        console.error('[API] deleteSubject failed:', err);
        throw err;
    }
}
