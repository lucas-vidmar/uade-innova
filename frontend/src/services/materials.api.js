import {
    BASE_URL, apiFetch, fetchWithTimeout
} from './core.js';

export async function getMaterialStatusBatch(subjectId, materialIds = []) {
    if (!subjectId || !Array.isArray(materialIds) || materialIds.length === 0) {
        return { subjectId, results: [] };
    }

    const deduped = Array.from(new Set(materialIds.map((item) => String(item || '').trim()).filter(Boolean)));
    if (deduped.length === 0) {
        return { subjectId, results: [] };
    }

    try {
        const res = await fetchWithTimeout(
            `${BASE_URL}/material-status/batch`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subjectId, materialIds: deduped }),
                timeout: 5000,
            }
        );

        if (!res.ok) {
            if (res.status === 404) {
                return await _getMaterialStatusBatchGet(subjectId, deduped);
            }
            throw new Error(`Error ${res.status}: material-status-batch`);
        }

        const data = await res.json();
        const results = Array.isArray(data?.results) ? data.results : [];
        return { subjectId, results };
    } catch (err) {
        console.error('[API] getMaterialStatusBatch failed, falling back to GET:', err);
        try {
            return await _getMaterialStatusBatchGet(subjectId, deduped);
        } catch (fallbackErr) {
            console.error('[API] getMaterialStatusBatch GET fallback also failed:', fallbackErr);
            throw fallbackErr;
        }
    }
}

export async function _getMaterialStatusBatchGet(subjectId, materialIds) {
    const params = new URLSearchParams({
        subjectId,
        materialIds: materialIds.join(','),
    });
    const res = await fetchWithTimeout(
        `${BASE_URL}/material-status?${params.toString()}`,
        { timeout: 3500 }
    );

    if (!res.ok) throw new Error(`Error ${res.status}: material-status-batch-get`);

    const data = await res.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    return { subjectId, results };
}

export async function getMaterialStatus(subjectId, materialId) {
    if (!subjectId || !materialId) return null;

    try {
        const res = await fetchWithTimeout(
            `${BASE_URL}/material-status/${encodeURIComponent(materialId)}?subjectId=${encodeURIComponent(subjectId)}`,
            { timeout: 3500 }
        );

        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`Error ${res.status}: material-status`);

        const data = await res.json();
        return data && typeof data === 'object' ? data : null;
    } catch (err) {
        console.error('[API] getMaterialStatus failed:', err);
        throw err;
    }
}

export async function ingestMaterial(formData) {
    let res;
    try {
        res = await apiFetch(`${BASE_URL}/ingest-material`, { method: 'POST', body: formData });
    } catch (err) {
        // Un fallo de red al subir NO es un alta exitosa. Antes se devolvía acá
        // un id local con status 'processing' y la pantalla mostraba el archivo
        // como cargado aunque el servidor nunca lo hubiera recibido (#386).
        const apiError = new Error('No se pudo contactar al servidor para subir el archivo. Revisá tu conexión y volvé a intentar.');
        apiError.errorCategory = 'NETWORK';
        apiError.code = 'INGEST_NETWORK_ERROR';
        apiError.cause = err;
        throw apiError;
    }

    if (!res.ok) {
        let message = `Error ${res.status}: no se pudo subir el material`;
        let errorCategory = null;
        let code = null;
        try {
            const contentType = res.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                const err = await res.json();
                if (err?.error) message = err.error;
                if (err?.errorCategory) errorCategory = err.errorCategory;
                if (err?.code) code = err.code;
            } else {
                const text = await res.text();
                if (text) message = text;
            }
        } catch {}

        const apiError = new Error(message);
        apiError.status = res.status;
        apiError.errorCategory = errorCategory;
        apiError.code = code;
        throw apiError;
    }

    return res.json();
}

export async function deleteMaterial(materialId) {
    const res = await apiFetch(`${BASE_URL}/materials/${materialId}`, { method: 'DELETE' });

    if (!res.ok) {
        let message = `Error ${res.status}: no se pudo eliminar el material`;
        try {
            const contentType = res.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                const err = await res.json();
                if (err?.error) message = err.error;
            } else {
                const text = await res.text();
                if (text) message = text;
            }
        } catch {}
        throw new Error(message);
    }

    return res.json();
}

export async function reprocessMaterial(materialId, subjectId) {
    if (!materialId) throw new Error('materialId es requerido');
    if (!subjectId) throw new Error('subjectId es requerido');
    const res = await apiFetch(`${BASE_URL}/materials/${encodeURIComponent(materialId)}/reprocess?subjectId=${encodeURIComponent(subjectId)}`, {
        method: 'POST',
    });

    if (!res.ok) {
        let message = `Error ${res.status}: no se pudo reprocesar el material`;
        try {
            const contentType = res.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                const err = await res.json();
                if (err?.error) message = err.error;
            } else {
                const text = await res.text();
                if (text) message = text;
            }
        } catch {}
        throw new Error(message);
    }

    return res.json();
}

export async function updateMaterial(subjectId, materialId, updates) {
    if (!subjectId || !materialId) throw new Error('subjectId y materialId son requeridos');
    const res = await apiFetch(`${BASE_URL}/materials/${encodeURIComponent(materialId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectId, ...updates }),
    });
    if (!res.ok) {
        let message = `Error ${res.status}: no se pudo actualizar el material`;
        try {
            const contentType = res.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                const err = await res.json();
                if (err?.error) message = err.error;
            }
        } catch {}
        throw new Error(message);
    }
    return res.json();
}

/**
 * #391: retirar una fuente la saca de las respuestas sin borrarla. Queda en la
 * lista con quién, cuándo y por qué, y se puede reponer dejando esa constancia.
 */
export async function retireMaterial(subjectId, materialId, reason) {
    return updateMaterial(subjectId, materialId, {
        retirementState: 'retirada',
        retireReason: reason || undefined,
    });
}

export async function restoreMaterial(subjectId, materialId) {
    return updateMaterial(subjectId, materialId, { retirementState: 'activa' });
}

export async function getMaterialText(subjectId, materialId) {
    if (!subjectId || !materialId) return { text: '' };
    try {
        const res = await fetchWithTimeout(
            `${BASE_URL}/materials/${encodeURIComponent(materialId)}/text?subjectId=${encodeURIComponent(subjectId)}`,
            { timeout: 8000 }
        );
        if (!res.ok) return { text: '' };
        const data = await res.json();
        return data && typeof data === 'object' ? data : { text: '' };
    } catch (err) {
        console.error('[API] getMaterialText failed:', err);
        return { text: '' };
    }
}

export async function updateMaterialText(subjectId, materialId, text) {
    if (!subjectId || !materialId) throw new Error('subjectId y materialId son requeridos');
    const res = await apiFetch(`${BASE_URL}/materials/${encodeURIComponent(materialId)}/text`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectId, text }),
    });
    if (!res.ok) {
        let message = `Error ${res.status}: no se pudo actualizar el texto`;
        try {
            const contentType = res.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                const err = await res.json();
                if (err?.error) message = err.error;
            }
        } catch {}
        throw new Error(message);
    }
    return res.json();
}

export async function getMaterialDownloadUrl(subjectId, materialId) {
    if (!subjectId || !materialId) throw new Error('subjectId and materialId are required');
    const res = await apiFetch(`${BASE_URL}/material-download?subjectId=${encodeURIComponent(subjectId)}&materialId=${encodeURIComponent(materialId)}`);
    if (!res.ok) {
        let message = 'Error al obtener URL de descarga';
        try { const err = await res.json(); if (err?.error) message = err.error; } catch {}
        throw new Error(message);
    }
    return res.json();
}
