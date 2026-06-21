import {
    USE_MOCK, BASE_URL, apiFetch, fetchWithTimeout, delay, readLocalJson, writeLocalJson,
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

    if (USE_MOCK) {
        await delay(400);
        return localClasses;
    }

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
    if (USE_MOCK) return;
    try {
        const res = await apiFetch(`${BASE_URL}/classes?subjectId=${subjectId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(classesArray)
        });
        if (!res.ok) {
            if (res.status >= 500 || res.status === 404) {
                setLocalClasses(subjectId, classesArray);
                return { success: true, classes: classesArray, fallback: true };
            }
            throw new Error(`Error ${res.status}: Falló el guardado en el servidor`);
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
    if (USE_MOCK) {
        await delay(800);
        return { classId, summary: "Resumen simulado para la clase " + classId, validated: false };
    }
    const res = await apiFetch(`${BASE_URL}/class-summary/${classId}`);
    if (!res.ok) return null;
    return res.json();
}

export async function saveClassSummary(classId, data) {
    if (USE_MOCK) return;
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
    if (USE_MOCK) {
        await delay(600);
        return {
            classId,
            mapCode: "graph TD\nA[Arquitectura] --> B[Patrones]\nA --> C[Atributos]\nB --> D[Microservicios]\nB --> E[Monolito]"
        };
    }
    const res = await apiFetch(`${BASE_URL}/class-map/${classId}`);
    if (!res.ok) return null;
    return res.json();
}

export async function saveClassMap(classId, data) {
    if (USE_MOCK) return;
    const res = await apiFetch(`${BASE_URL}/class-map/${classId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    return res.json();
}

export async function getClassTimeline(classId) {
    if (USE_MOCK) {
        await delay(400);
        return {
            classId,
            sections: [
                { id: 'm-01-sec-001', startSecond: 0, endSecond: 60, timestampLabel: '00:00:00', text: 'Introduccion a arquitectura de software.' },
                { id: 'm-01-sec-002', startSecond: 60, endSecond: 120, timestampLabel: '00:01:00', text: 'Pregunta sobre atributos de calidad.' },
            ],
            markers: [
                { id: 'm-01-mk-001', sectionId: 'm-01-sec-001', startSecond: 0, endSecond: 60, iconType: 'question', label: 'Introduccion y contexto' },
                { id: 'm-01-mk-002', sectionId: 'm-01-sec-002', startSecond: 60, endSecond: 120, iconType: 'assignment', label: 'Ejercicio de atributos' },
            ],
        };
    }
    const res = await apiFetch(`${BASE_URL}/class-timeline/${classId}`);
    if (!res.ok) return { classId, sections: [], markers: [] };
    return res.json();
}

export async function saveClassTimeline(classId, payload) {
    if (USE_MOCK) return payload;
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
