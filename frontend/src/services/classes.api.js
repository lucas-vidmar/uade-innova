import {
    BASE_URL, apiFetch, fetchWithTimeout, readLocalJson, writeLocalJson,
    LOCAL_CLASSES_KEY
} from './core.js';

function getLocalClasses(subjectId) {
    const classesBySubject = readLocalJson(LOCAL_CLASSES_KEY, {});
    if (!classesBySubject || typeof classesBySubject !== 'object') return [];
    const classes = classesBySubject[subjectId];
    return Array.isArray(classes) ? classes : [];
}

function setLocalClasses(subjectId, classesArray) {
    const classesBySubject = readLocalJson(LOCAL_CLASSES_KEY, {});
    const safeMap = classesBySubject && typeof classesBySubject === 'object' ? classesBySubject : {};
    safeMap[subjectId] = Array.isArray(classesArray) ? classesArray : [];
    writeLocalJson(LOCAL_CLASSES_KEY, safeMap);
}

export async function getClasses(subjectId) {
    const localClassesBySubject = readLocalJson(LOCAL_CLASSES_KEY, {});
    const localClasses = Array.isArray(localClassesBySubject[subjectId]) ? localClassesBySubject[subjectId] : [];

    try {
        const res = await apiFetch(`${BASE_URL}/classes?subjectId=${subjectId}`);
        if (!res.ok) return localClasses;
        const data = await res.json();
        const classes = Array.isArray(data) ? data : [];
        setLocalClasses(subjectId, classes);
        return classes;
    } catch (err) {
        console.error('[API] getClasses failed:', err);
        return localClasses;
    }
}

export async function saveClasses(subjectId, classesArray) {
    try {
        const res = await apiFetch(`${BASE_URL}/classes?subjectId=${subjectId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(classesArray)
        });
        if (!res.ok) {
            setLocalClasses(subjectId, classesArray);
            return { success: true, classes: classesArray, fallback: true };
        }
        const data = await res.json();
        setLocalClasses(subjectId, classesArray);
        return data;
    } catch (err) {
        setLocalClasses(subjectId, classesArray);
        return { success: true, classes: classesArray, fallback: true };
    }
}

export async function saveClass(subjectId, classData) {
    const classes = await getClasses(subjectId);
    const index = classes.findIndex(c => c.id === classData.id);

    const newClasses = [...classes];
    if (index >= 0) {
        newClasses[index] = { ...newClasses[index], ...classData };
    } else {
        newClasses.push(classData);
    }

    return saveClasses(subjectId, newClasses);
}

export async function deleteClass(subjectId, classId) {
    const classes = await getClasses(subjectId);
    const newClasses = classes.filter(c => c.id !== classId);
    return saveClasses(subjectId, newClasses);
}

export async function getClassSummary(classId) {
    const res = await apiFetch(`${BASE_URL}/class-summary/${classId}`);
    if (!res.ok) return null;
    return res.json();
}

export async function saveClassSummary(classId, data) {
    const res = await apiFetch(`${BASE_URL}/class-summary/${classId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    return res.json();
}

export function getClassAudioUrl(classId, subjectId) {
    const params = new URLSearchParams();
    if (subjectId) params.set('subjectId', subjectId);
    const query = params.toString();
    return `${BASE_URL}/class-audio/${classId}${query ? `?${query}` : ''}`;
}

export async function getClassMap(classId) {
    const res = await apiFetch(`${BASE_URL}/class-map/${classId}`);
    if (!res.ok) return null;
    return res.json();
}

export async function saveClassMap(classId, data) {
    const res = await apiFetch(`${BASE_URL}/class-map/${classId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    return res.json();
}

export async function getClassTimeline(classId) {
    const res = await apiFetch(`${BASE_URL}/class-timeline/${classId}`);
    if (!res.ok) return { classId, sections: [], markers: [] };
    return res.json();
}

export async function saveClassTimeline(classId, payload) {
    const res = await apiFetch(`${BASE_URL}/class-timeline/${classId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        throw new Error(`Error ${res.status}: No se pudo guardar la linea de tiempo`);
    }
    return res.json();
}

export async function generateClassMap(classId, subjectId) {
    const params = subjectId ? `?subjectId=${encodeURIComponent(subjectId)}` : '';
    const res = await apiFetch(`${BASE_URL}/class-map/${classId}/generate${params}`, { method: 'POST' });
    if (!res.ok) {
        let message = `Error ${res.status}: No se pudo generar el mapa`;
        try { const err = await res.json(); if (err?.error) message = err.error; } catch {}
        throw new Error(message);
    }
    return res.json();
}
