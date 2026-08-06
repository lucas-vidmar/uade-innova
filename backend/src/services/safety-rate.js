/**
 * services/safety-rate.js — Tasa Fallo Seguro (Fail-Safe Rate) aggregation
 *
 * Combines RAG interaction counts (SessionMetrics) with categorized RAG error
 * events (RAGErrorEvents) to produce a fail-safe completion rate metric.
 * Data sources:
 *   - error-categories.js taxonomy (SAFETY / categorized failures)
 *   - RAG telemetry persisted to the RAGErrorEvents table (see telemetry.trackRAGError)
 *   - SessionMetrics table (total requests per subject)
 */
import { getTableClient } from './storage.js';

export const RAG_ERROR_EVENTS_TABLE = 'RAGErrorEvents';
const SESSION_METRICS_TABLE = 'SessionMetrics';

function parseDate(value) {
    if (!value) return null;
    const ts = value instanceof Date ? value : new Date(value);
    return Number.isNaN(ts.getTime()) ? null : ts;
}

function inWindow(ts, windowDays) {
    if (!ts) return false;
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    return ts.getTime() >= cutoff;
}

/**
 * Persiste un evento de error RAG categorizado en la tabla RAGErrorEvents.
 * Se invoca desde telemetry.trackRAGError para que todos los errores de RAG
 * queden disponibles para la métrica de Tasa Fallo Seguro.
 */
export async function recordRAGErrorEvent({
    errorCategory,
    code,
    message,
    subjectId,
    userId,
    classIds,
    correlationId,
    timestamp = new Date().toISOString(),
} = {}) {
    try {
        const client = getTableClient(RAG_ERROR_EVENTS_TABLE);
        await client.createTable().catch(() => {});
        const rowKey = `err-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        await client.upsertEntity({
            partitionKey: subjectId || 'unknown',
            rowKey,
            errorCategory: errorCategory || 'UNKNOWN',
            code: code || 'UNKNOWN_ERROR',
            message: message ? String(message).slice(0, 500) : '',
            userId: userId || 'anonymous',
            classIds: Array.isArray(classIds) ? classIds.join(',') : (classIds || ''),
            correlationId: correlationId || '',
            timestamp,
            createdAt: new Date().toISOString(),
        }, 'Merge');
    } catch (err) {
        console.warn(`[SafetyRate] Failed to persist RAG error event: ${err.message}`);
    }
}

async function listEntities(client, subjectId) {
    const filter = subjectId
        ? `PartitionKey eq '${String(subjectId).replace(/'/g, "''")}'`
        : undefined;
    const iter = client.listEntities({ queryOptions: filter ? { filter } : undefined });
    const rows = [];
    for await (const row of iter) {
        rows.push(row);
    }
    return rows;
}

/**
 * Dado un conjunto de requests y errores, calcula el reporte para una ventana.
 */
export function buildReport(requests, errors, windowDays) {
    const inRequests = requests.filter(r => inWindow(parseDate(r?.timestamp || r?.Timestamp), windowDays));
    const inErrors = errors.filter(e => inWindow(parseDate(e?.timestamp || e?.Timestamp), windowDays));

    const blockedBySafety = inErrors.filter(e => e?.errorCategory === 'SAFETY').length;
    // CLIENT_ABORT corresponde a desconexión del cliente, no a un fallo del sistema
    const errorCategorizedFailures = inErrors.filter(e => e?.errorCategory !== 'CLIENT_ABORT').length;

    const totalRequests = inRequests.length;
    const safeCompletions = Math.max(0, totalRequests - errorCategorizedFailures);
    const safetyRatePercent = totalRequests > 0
        ? Math.round((safeCompletions / totalRequests) * 10000) / 100
        : 100;

    return { totalRequests, safeCompletions, blockedBySafety, errorCategorizedFailures, safetyRatePercent };
}

/**
 * Calcula la métrica de Tasa Fallo Seguro para una materia (o global si no se pasa subjectId).
 * Devuelve el reporte de 30 días con el trend comparando 7d vs 30d.
 */
export async function computeSafetyRate(context, { subjectId, windowDays = 30 } = {}) {
    let requests = [];
    let errors = [];

    try {
        const sessionClient = getTableClient(SESSION_METRICS_TABLE);
        await sessionClient.createTable().catch(() => {});
        const rows = await listEntities(sessionClient, subjectId);
        requests = rows.filter(row => String(row?.eventType || '').trim() !== 'material-upload');
    } catch (err) {
        if (context && typeof context.warn === 'function') {
            context.warn(`[SafetyRate] Could not read ${SESSION_METRICS_TABLE}: ${err.message}`);
        }
    }

    try {
        const errClient = getTableClient(RAG_ERROR_EVENTS_TABLE);
        await errClient.createTable().catch(() => {});
        errors = await listEntities(errClient, subjectId);
    } catch (err) {
        if (context && typeof context.warn === 'function') {
            context.warn(`[SafetyRate] Could not read ${RAG_ERROR_EVENTS_TABLE}: ${err.message}`);
        }
    }

    const report30 = buildReport(requests, errors, windowDays);
    const report7 = buildReport(requests, errors, 7);

    return {
        subjectId: subjectId || null,
        ...report30,
        windowDays,
        trend: {
            '7d': report7.safetyRatePercent,
            '30d': report30.safetyRatePercent,
        },
        source: { storage: 'Azure Table Storage', tables: [SESSION_METRICS_TABLE, RAG_ERROR_EVENTS_TABLE] },
        updatedAt: new Date().toISOString(),
    };
}
