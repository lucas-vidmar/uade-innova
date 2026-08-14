/**
 * services/telemetry.js — Azure Application Insights custom telemetry
 *
 * Emits structured custom events per student interaction for Issue #69.
 * Events are queryable via KQL in App Insights and can feed Azure Workbooks.
 *
 * Gracefully no-ops when APPLICATIONINSIGHTS_CONNECTION_STRING is not set
 * so that local development is unaffected.
 */

import { recordRAGErrorEvent } from './safety-rate.js';
import { CONFIG } from '../config.js';

let _clientPromise = null;

/**
 * Returns the App Insights TelemetryClient (async), or null in local dev / missing config.
 * @returns {Promise<import('applicationinsights').TelemetryClient | null>}
 */
async function getClient() {
    if (_clientPromise !== null) return _clientPromise;

    const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
    if (!connectionString) {
        console.warn('[Telemetry] APPLICATIONINSIGHTS_CONNECTION_STRING not set — App Insights telemetry disabled.');
        _clientPromise = Promise.resolve(null);
        return null;
    }

    _clientPromise = (async () => {
        try {
            const { default: appInsights } = await import('applicationinsights');
            appInsights.setup(connectionString)
                .setAutoCollectRequests(false)
                .setAutoCollectDependencies(false)
                .setAutoCollectExceptions(true)
                .start();
            console.log('[Telemetry] Application Insights client initialized.');
            return appInsights.defaultClient;
        } catch (err) {
            console.error('[Telemetry] Failed to initialize App Insights client:', err.message);
            return null;
        }
    })();

    return _clientPromise;
}

/**
 * Tracks a RAG interaction custom event in App Insights.
 *
 * @param {object} params
 * @param {string} params.userId            - Entra ID OID or "anonymous"
 * @param {string} params.subjectId         - Materia identifier
 * @param {number} params.promptTokens      - Tokens consumed in the prompt
 * @param {number} params.completionTokens  - Tokens consumed in the completion
 * @param {number} params.totalTokens       - Total tokens (prompt + completion)
 * @param {number} params.durationMs        - Wall-clock latency of the full RAG pipeline (ms)
 * @param {number} [params.networkSetupMs]  - Latency of the network/setup phase before the LLM call (ms)
 * @param {number} [params.ttftMs]          - Time to first token in stream mode (ms)
 * @param {string} params.promptVersion     - A/B prompt version ID (Issue #80)
 * @param {string} [params.interactionId]   - Unique ID for this chat turn
 * @param {string} [params.firstTokenAt]    - ISO timestamp when first SSE token was emitted
 * @param {number} [params.selectedClassCount] - Number of unique classes selected for context
 * @param {string} [params.sourceMix] - Classification of material types used in the response (e.g. 'notes+bibliography', 'notes-only', 'bibliography-only', 'transcript-only', 'presentation-only', 'mixed-other', 'none', 'unknown')
 * @param {string} [params.correlationId] - Trace correlation ID for joining with request telemetry in KQL
 * @param {string} [params.winnerDeclared] - Prompt version declared as winner (null if none)
 */
export async function trackRAGInteraction({
    userId,
    subjectId,
    promptTokens,
    completionTokens,
    totalTokens,
    durationMs,
    networkSetupMs,
    ttftMs,
    promptVersion,
    interactionId,
    firstTokenAt,
    filterType,
    selectedClassCount,
    sourceMix,
    correlationId,
    winnerDeclared,
    sandbox,
    simulateStudent,
}) {
    const client = await getClient();
    if (!client) return;

    client.trackEvent({
        name: 'RAGInteraction',
        properties: {
            userId: userId || 'anonymous',
            subjectId,
            promptVersion: promptVersion || 'default',
            interactionId: interactionId || 'unknown',
            firstTokenAt: firstTokenAt || null,
            filterType: filterType || 'unknown',
            sourceMix: sourceMix || 'unknown',
            ...(sandbox && { sandbox: 'true' }),
            ...(simulateStudent && { simulateStudent: 'true' }),
            ...(correlationId && { correlationId }),
            ...(winnerDeclared && { winnerDeclared }),
        },
        measurements: {
            promptTokens: promptTokens || 0,
            completionTokens: completionTokens || 0,
            totalTokens: totalTokens || 0,
            durationMs: durationMs || 0,
            networkSetupMs: Number.isFinite(networkSetupMs) ? networkSetupMs : 0,
            ttftMs: Number.isFinite(ttftMs) ? ttftMs : 0,
            selectedClassCount: Number.isFinite(selectedClassCount) ? selectedClassCount : 0,
        },
    });
}

/**
 * Tracks Pinecone vector-query dependency latency in App Insights.
 *
 * @param {object} params
 * @param {string} [params.provider]     - Vector provider name (default: pinecone)
 * @param {string} [params.index]        - Vector index identifier
 * @param {string} [params.indexName]    - Alias for index
 * @param {string} [params.target]       - Dependency target endpoint
 * @param {string} [params.operation]    - Operation name
 * @param {number} params.durationMs     - Dependency latency in milliseconds
 * @param {boolean} [params.success]     - Whether dependency call succeeded
 * @param {string|number} [params.resultCode] - Result code / status code
 * @param {string} [params.correlationId] - Trace correlation ID for joining with request telemetry in KQL
 */
export async function trackVectorSearchDependency({
    provider = 'pinecone',
    index,
    indexName,
    target,
    operation = 'vector.search',
    durationMs,
    success = true,
    resultCode,
    correlationId,
}) {
    const client = await getClient();
    if (!client) return;

    const resolvedIndex = index || indexName || process.env.PINECONE_INDEX_NAME || 'unknown-index';
    const resolvedTarget = target || process.env.PINECONE_HOST || 'pinecone';

    client.trackDependency({
        target: resolvedTarget,
        name: operation,
        data: `indexes/${resolvedIndex}/docs/search`,
        duration: Math.max(0, Number(durationMs) || 0),
        success: Boolean(success),
        resultCode: String(resultCode ?? (success ? 200 : 500)),
        dependencyTypeName: 'Pinecone',
        properties: {
            provider,
            index: resolvedIndex,
            indexName: resolvedIndex,
            ...(correlationId && { correlationId }),
        },
    });
}

/**
 * Tracks a material ingestion (file processing) custom event in App Insights.
 *
 * @param {object} params
 * @param {string} params.userId         - Entra ID OID who initiated the upload
 * @param {string} params.materialId     - Unique identifier for the material
 * @param {string} params.fileName       - Original filename
 * @param {string} params.materialType   - Material type (transcript, notes, etc.)
 * @param {number} params.totalTokens    - Sum of all tokens used (embeddings + summary + map)
 * @param {number} params.durationMs     - Full execution time of the document pipeline (ms)
 * @param {string} [params.status]       - 'success' or 'error'
 * @param {string} [params.correlationId] - Trace correlation ID for joining with request telemetry in KQL
 */
export async function trackIngestionInteraction({
    userId,
    materialId,
    fileName,
    materialType,
    totalTokens,
    durationMs,
    status = 'success',
    correlationId,
}) {
    const client = await getClient();
    if (!client) return;

    client.trackEvent({
        name: 'IngestionInteraction',
        properties: {
            userId: userId || 'anonymous',
            materialId,
            fileName,
            materialType,
            status,
            ...(correlationId && { correlationId }),
        },
        measurements: {
            totalTokens: totalTokens || 0,
            durationMs: durationMs || 0,
        },
    });
}

/**
 * Tracks a user login event in App Insights for login-frequency analysis.
 *
 * @param {object} params
 * @param {string}   params.userId - Entra ID OID
 * @param {string[]} params.roles  - Application roles assigned to the user
 */
export async function trackUserLogin({ userId, roles = [] }) {
    const client = await getClient();
    if (!client) return;

    client.trackEvent({
        name: 'UserLogin',
        properties: {
            userId: userId || 'anonymous',
            roles: Array.isArray(roles) ? roles.join(',') : String(roles),
        },
    });
}

/**
 * Tracks a timer-triggered dispatcher run with structured execution metrics.
 *
 * @param {object} params
 * @param {string} params.dispatcherName  - Name of the dispatcher (e.g. 'post-class-summary')
 * @param {number} params.subjectCount    - Total subjects evaluated
 * @param {number} params.classCount      - Total classes iterated across all subjects
 * @param {number} params.dispatched      - Notifications successfully upserted
 * @param {number} params.skipped         - Items skipped (future date, not ready, etc.)
 * @param {number} params.errors          - Count of errors caught during the run
 * @param {number} params.durationMs      - Wall-clock execution time in milliseconds
 * @param {number} [params.retryAttempts] - Total retry attempts across all upsert operations
 * @param {number} [params.deadLetterWrites] - Total dead-letter blobs written due to exhaustion
 * @param {string} [params.errorDetails]  - Concatenated error context for troubleshooting (subjectId/classId)
 */
export async function trackDispatcherRun({
    dispatcherName = 'unknown',
    subjectCount = 0,
    classCount = 0,
    dispatched = 0,
    skipped = 0,
    errors = 0,
    retryAttempts = 0,
    deadLetterWrites = 0,
    durationMs = 0,
    errorDetails,
}) {
    const client = await getClient();
    if (!client) return;

    client.trackEvent({
        name: 'DispatcherRun',
        properties: {
            dispatcherName: dispatcherName || 'unknown',
            errorDetails: errorDetails || '',
        },
        measurements: {
            subjectCount: Math.max(0, Number(subjectCount) || 0),
            classCount: Math.max(0, Number(classCount) || 0),
            dispatched: Math.max(0, Number(dispatched) || 0),
            skipped: Math.max(0, Number(skipped) || 0),
            errors: Math.max(0, Number(errors) || 0),
            retryAttempts: Math.max(0, Number(retryAttempts) || 0),
            deadLetterWrites: Math.max(0, Number(deadLetterWrites) || 0),
            durationMs: Math.max(0, Number(durationMs) || 0),
        },
    });
}

/**
 * Tracks a dead-letter write event when a notification payload exhausts all retries.
 *
 * @param {object} params
 * @param {string} params.subjectId     - Subject identifier
 * @param {string} params.notificationId - Original notification ID
 * @param {string} params.blobPath      - Dead-letter blob path in storage
 * @param {number} params.retryCount    - Number of retry attempts before dead-letter
 * @param {string} params.originalError - Truncated error message from the last saveJson attempt
 */
export async function trackDeadLetterWrite({
    subjectId,
    notificationId,
    blobPath,
    retryCount,
    originalError,
}) {
    const client = await getClient();
    if (!client) return;

    client.trackEvent({
        name: 'DeadLetterWrite',
        properties: {
            subjectId: subjectId || 'unknown',
            notificationId: notificationId || 'unknown',
            blobPath: blobPath || 'unknown',
            retryCount: String(retryCount || 0),
            originalError: originalError ? String(originalError).slice(0, 500) : '',
        },
    });
}

/**
 * Tracks a categorized RAG error event for telemetry monitoring.
 *
 * @param {object} params
 * @param {string} params.errorCategory - One of SAFETY, RETRIEVAL_FAILURE, PARSING, LLM
 * @param {string} params.code         - Specific error code from the categorized error
 * @param {string} [params.message]    - Human-readable error message (truncated to 500)
 * @param {string} params.subjectId    - Subject identifier for filtering
 * @param {string} [params.userId]     - User identifier
 * @param {string|string[]} [params.classIds] - Class identifier(s) for correlation
 * @param {string} [params.correlationId] - Trace correlation ID
 * @param {string} [params.stackTrace] - Error stack trace (truncated to 2000)
 */
export async function trackRAGError({
    errorCategory,
    code,
    message,
    subjectId,
    userId,
    classIds,
    correlationId,
    stackTrace,
}) {
    const client = await getClient();

    // Persist to Table Storage for the Tasa Fallo Seguro metric (Issue #212).
    // Runs regardless of App Insights availability so the metric has data
    // even in local/development environments.
    await recordRAGErrorEvent({
        errorCategory,
        code,
        message,
        subjectId,
        userId,
        classIds,
        correlationId,
    }).catch(e => console.warn('[Telemetry] Error persisting RAG error event for safety-rate:', e.message));

    if (!client) return;

    client.trackEvent({
        name: 'RAGErrorCategorized',
        properties: {
            errorCategory: errorCategory || 'UNKNOWN',
            code: code || 'UNKNOWN_ERROR',
            message: message ? String(message).slice(0, 500) : '',
            subjectId: subjectId || 'unknown',
            userId: userId || 'anonymous',
            classIds: Array.isArray(classIds) ? classIds.join(',') : (classIds || ''),
            correlationId: correlationId || '',
            stackTrace: stackTrace ? String(stackTrace).slice(0, 2000) : '',
        },
    });

    await client.flush({ isAppCrashing: true });
}

/**
 * Audits an unanswered RAG query — a query that produced no usable answer
 * (refusal from no context, empty model output, or a safety-blocked response).
 *
 * Persisted to the UnansweredQueries table + emitted as an App Insights custom
 * event so operators can surface prompt-injection attempts or knowledge gaps
 * (Issue #221).
 *
 * @param {object} params
 * @param {string} params.question         - The raw user question
 * @param {string} [params.rewrittenQuestion] - Rewritten query sent to retrieval
 * @param {string} params.reason           - One of: 'no_context' | 'empty_answer' | 'safety_blocked'
 * @param {string} params.subjectId        - Subject identifier
 * @param {string} [params.userId]         - User identifier
 * @param {string|string[]} [params.classIds] - Class identifier(s)
 * @param {string} [params.correlationId]  - Trace correlation ID
 * @param {number} [params.sourcesCount]   - Number of retrieved chunks (0 for no-context)
 */
export async function trackUnansweredQuery({
    question,
    rewrittenQuestion,
    reason,
    subjectId,
    userId,
    classIds,
    correlationId,
    sourcesCount,
}) {
    const client = await getClient();
    const tableName = CONFIG.tables.unansweredQueries || 'UnansweredQueries';
    try {
        const { getTableClient } = await import('./storage.js');
        const tableClient = getTableClient(tableName);
        await tableClient.createTable().catch(() => {});
        const rowKey = `uq-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        await tableClient.upsertEntity({
            partitionKey: subjectId || 'unknown',
            rowKey,
            question: question ? String(question).slice(0, 500) : '',
            rewrittenQuestion: rewrittenQuestion ? String(rewrittenQuestion).slice(0, 500) : '',
            reason: reason || 'unknown',
            userId: userId || 'anonymous',
            classIds: Array.isArray(classIds) ? classIds.join(',') : (classIds || ''),
            correlationId: correlationId || '',
            sourcesCount: Number(sourcesCount) || 0,
            timestamp: new Date().toISOString(),
            createdAt: new Date().toISOString(),
        }, 'Merge');
    } catch (err) {
        console.warn(`[Telemetry] Failed to persist unanswered query event: ${err.message}`);
    }

    if (!client) return;

    client.trackEvent({
        name: 'UnansweredQuery',
        properties: {
            reason: reason || 'unknown',
            subjectId: subjectId || 'unknown',
            userId: userId || 'anonymous',
            classIds: Array.isArray(classIds) ? classIds.join(',') : (classIds || ''),
            correlationId: correlationId || '',
            question: question ? String(question).slice(0, 200) : '',
        },
        measurements: {
            sourcesCount: Number(sourcesCount) || 0,
        },
    });
}

/**
 * Tracks processing-notification polling telemetry for measuring
 * material-status endpoint load reduction and reliability.
 *
 * Emitted by both backend material-status handlers and the frontend
 * processing-notifications service (via POST /api/telemetry/polling).
 *
 * @param {object} params
 * @param {string} params.eventType      - One of: material_status_batch_success,
 *   material_status_batch_get_success, material_status_single_success,
 *   classes_fallback, per_item_fallback, polling_error
 * @param {string} [params.subjectId]    - Subject identifier for aggregation
 * @param {number} [params.materialCount]- Number of materials in the poll batch
 * @param {number} [params.latencyMs]    - Wall-clock duration of the poll operation
 * @param {string} [params.errorMessage] - Truncated error message (max 500 chars)
 * @param {string} [params.endpoint]     - Which HTTP endpoint was called
 */
export async function trackPollingEvent({
    eventType,
    subjectId,
    materialCount,
    latencyMs,
    errorMessage,
    endpoint,
}) {
    const client = await getClient();
    if (!client) return;

    client.trackEvent({
        name: 'PollingEvent',
        properties: {
            eventType: eventType || 'unknown',
            subjectId: subjectId || 'unknown',
            endpoint: endpoint || 'unknown',
            errorMessage: errorMessage ? String(errorMessage).slice(0, 500) : '',
            pollSource: typeof window !== 'undefined' ? 'frontend' : 'backend',
        },
        measurements: {
            materialCount: Math.max(0, Number(materialCount) || 0),
            latencyMs: Math.max(0, Number(latencyMs) || 0),
        },
    });
}

/**
 * Tracks a production auth-fallback attempt that was blocked by the frontend.
 *
 * Emitted when `/.auth/me` fails in a production build (import.meta.env.DEV === false)
 * and the app refuses to silently downgrade to a mock student session (Story 10.4 / #202).
 *
 * @param {object} params
 * @param {string} [params.url]           - URL where the fallback was blocked
 * @param {string} [params.correlationId] - Trace correlation ID
 */
export async function trackAuthFallbackBlocked({ url, correlationId }) {
    const client = await getClient();
    if (!client) return;

    client.trackEvent({
        name: 'AuthFallbackBlocked',
        properties: {
            source: 'frontend',
            url: url ? String(url).slice(0, 500) : '',
            ...(correlationId && { correlationId }),
        },
    });
}

/**
 * Tracks notification-center interactions (quick actions/read acknowledgements).
 *
 * @param {object} params
 * @param {string} params.action
 * @param {string} params.status
 * @param {string} params.userId
 * @param {string} params.subjectId
 * @param {string} params.notificationId
 */
export async function trackNotificationInteraction({
    action,
    status,
    userId,
    subjectId,
    notificationId,
}) {
    const client = await getClient();
    if (!client) return;

    client.trackEvent({
        name: 'NotificationInteraction',
        properties: {
            action: action || 'unknown',
            status: status || 'unknown',
            userId: userId || 'anonymous',
            subjectId: subjectId || 'unknown',
            notificationId: notificationId || 'unknown',
        },
    });
}

/**
 * Tracks a vector backup/cleanup run for ops dashboard monitoring.
 *
 * @param {object} params
 * @param {string} params.runId         - Unique run identifier (UUID)
 * @param {string} params.mode          - 'backup-only' or 'backup+cleanup'
 * @param {string} [params.subjectScope] - Subject ID scope, or 'all' for full index
 * @param {number} params.durationMs    - Wall-clock execution time in milliseconds
 * @param {number} params.vectorCount   - Number of vectors processed
 * @param {boolean} params.success      - Whether the run completed successfully
 * @param {string} [params.errorCategory] - Normalized error category on failure
 * @param {string} [params.errorMessage]  - Error details on failure (truncated to 500)
 */
/**
 * Tracks a vector index anomaly alert event for ops monitoring.
 *
 * Emitted by the vector-health-monitor timer function when index fullness,
 * document growth, or connectivity thresholds are breached.
 *
 * @param {object} params
 * @param {string} params.alertType       - 'fullness' | 'growthSpike' | 'connectivity'
 * @param {string} params.indexName       - Pinecone index name
 * @param {number} params.observedValue   - The observed metric value that triggered the alert
 * @param {number} params.threshold       - The threshold that was breached
 * @param {number} params.dedupWindowMinutes - Dedup window in minutes (prevents alert storms)
 * @param {number} [params.vectorCount]   - Total vector count at time of alert
 * @param {number} [params.indexFullness] - Index fullness ratio at time of alert
 * @param {string} [params.errorMessage]  - Error details for connectivity alerts
 */
export async function trackVectorIndexAnomalyAlert({
    alertType = 'fullness',
    indexName,
    observedValue,
    threshold,
    dedupWindowMinutes = 60,
    vectorCount,
    indexFullness,
    errorMessage,
}) {
    const client = await getClient();
    if (!client) return;

    client.trackEvent({
        name: 'VectorIndexAnomalyAlert',
        properties: {
            alertType,
            indexName: indexName || process.env.PINECONE_INDEX_NAME || 'unknown',
            dedupWindowMinutes: String(dedupWindowMinutes),
            ...(errorMessage && { errorMessage: String(errorMessage).slice(0, 500) }),
        },
        measurements: {
            observedValue: Number.isFinite(observedValue) ? observedValue : 0,
            threshold: Number.isFinite(threshold) ? threshold : 0,
            vectorCount: Number.isFinite(vectorCount) ? vectorCount : 0,
            indexFullness: Number.isFinite(indexFullness) ? indexFullness : 0,
        },
    });

    await client.flush({ isAppCrashing: true });
}

export async function trackVectorBackupRun({
    runId,
    mode = 'backup-only',
    subjectScope = 'all',
    durationMs = 0,
    vectorCount = 0,
    success = true,
    errorCategory,
    errorMessage,
}) {
    const client = await getClient();
    if (!client) return;

    client.trackEvent({
        name: 'VectorBackupRun',
        properties: {
            runId,
            mode,
            subjectScope: subjectScope || 'all',
            success: String(success),
            ...(errorCategory && { errorCategory }),
            ...(errorMessage && { errorMessage: String(errorMessage).slice(0, 500) }),
        },
        measurements: {
            durationMs: Math.max(0, Number(durationMs) || 0),
            vectorCount: Math.max(0, Number(vectorCount) || 0),
        },
    });
}
