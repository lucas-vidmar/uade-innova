import {
    BASE_URL, apiFetch, fetchWithTimeout, delay, readLocalJson, writeLocalJson,
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

export { mergeSubjectsWithLocal };

export async function getSubjects() {
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
            } catch {}

            const fallbackSubject = {
                id: subject.id || `subject-${Date.now()}`,
                name: subject.name,
                oneLiner: subject.oneLiner || '',
                comment: subject.comment || subject.oneLiner || '',
                professorIds: subject.professorIds || [],
            };
            upsertLocalSubject(fallbackSubject);
            return fallbackSubject;
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
            } catch {}
            throw new Error(message);
        }

        removeLocalSubject(subjectId);
        return res.json();
    } catch (err) {
        console.error('[API] deleteSubject failed:', err);
        throw err;
    }
}
