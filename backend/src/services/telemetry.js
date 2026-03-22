/**
 * services/telemetry.js — Azure Application Insights custom telemetry
 *
 * Emits structured custom events per student interaction for Issue #69.
 * Events are queryable via KQL in App Insights and can feed Azure Workbooks.
 *
 * Gracefully no-ops when APPLICATIONINSIGHTS_CONNECTION_STRING is not set
 * so that local development is unaffected.
 */

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
 * @param {string} params.promptVersion     - A/B prompt version ID (Issue #80)
 * @param {string} [params.interactionId]   - Unique ID for this chat turn
 */
export async function trackRAGInteraction({
    userId,
    subjectId,
    promptTokens,
    completionTokens,
    totalTokens,
    durationMs,
    promptVersion,
    interactionId,
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
        },
        measurements: {
            promptTokens: promptTokens || 0,
            completionTokens: completionTokens || 0,
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
            roles: roles.join(','),
        },
    });
}
