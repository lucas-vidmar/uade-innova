import { app } from '@azure/functions';
import { withAuth } from '../middleware/with-auth.js';
import { withCorrelation } from '../middleware/with-correlation.js';
import { parseClientPrincipal, validateFrontDoorId, resolveIdentityKey } from '../services/auth-utils.js';

const tableName = "UserProfiles";
const storageAccountUrl = `https://${process.env.AZURE_STORAGE_ACCOUNT_NAME}.table.core.windows.net`;

// Bot preferences (story 11-5-1): valid values. Invalid payload values are
// dropped so the stored (existing) value is preserved.
const BOT_TONES = ['formal', 'didactic', 'concise'];
const BOT_LENGTHS = ['concise', 'detailed'];

function normalizeBotPrefs(value) {
    const normalized = {};
    if (BOT_TONES.includes(value.botTone)) normalized.botTone = value.botTone;
    if (BOT_LENGTHS.includes(value.botLength)) normalized.botLength = value.botLength;
    if (typeof value.includeSources === 'boolean') normalized.includeSources = value.includeSources;
    return normalized;
}

app.http('save-profile', {
    methods: ['POST', 'PUT'],
    authLevel: 'anonymous',
    handler: withCorrelation(withAuth(async (request, context) => {
        if (!validateFrontDoorId(request)) return { status: 403, body: JSON.stringify({ error: 'Forbidden - Invalid Front Door ID' }) };
        try {
            const principal = parseClientPrincipal(request);

            // Single per-user identity (#329): must match get-profile's
            // `user?.userId` read key. Session principals have no oid.
            const userId = resolveIdentityKey(request, context);

            const reqBody = await request.json();

            // Only update fields the client actually sent. "Merge" upsert (not
            // "Replace") prevents a partial save (e.g. only bot preferences)
            // from clobbering previously stored theme/language/consent, and
            // avoids the read-modify-write lost-update race.
            const entity = {
                partitionKey: "Profiles",
                rowKey: userId,
                name: principal?.userDetails || "Local User",
                email: principal?.userDetails || "local@uade.edu.ar",
            };
            if (typeof reqBody?.theme === 'string' && reqBody.theme) entity.theme = reqBody.theme;
            if (typeof reqBody?.language === 'string' && reqBody.language) entity.language = reqBody.language;
            if (typeof reqBody?.consentAccepted === 'boolean') entity.consentAccepted = reqBody.consentAccepted;

            const botPrefs = normalizeBotPrefs(reqBody || {});
            if (botPrefs.botTone) entity.botTone = botPrefs.botTone;
            if (botPrefs.botLength) entity.botLength = botPrefs.botLength;
            if (botPrefs.includeSources !== undefined) entity.includeSources = botPrefs.includeSources;

            const { getTableClient } = await import('../services/storage.js');
            const tableClient = getTableClient(tableName);

            // Fresh stores (local Azurite, new envs) may not have the table
            // yet — create idempotently before the first upsert (#329).
            await tableClient.createTable().catch(() => {});

            // Upsert the data seamlessly handling initial creation or subsequent updates
            await tableClient.upsertEntity(entity, "Merge");

            context.log(`[SaveProfile] Profile saved userId=${userId} theme=${entity.theme} botTone=${entity.botTone} botLength=${entity.botLength} includeSources=${entity.includeSources}`);

            return {
                status: 200,
                jsonBody: { message: "Profile saved successfully" }
            };

        } catch (error) {
            context.error('Error saving profile:', error);
            return {
                status: 500,
                body: "Internal Server Error"
            };
        }
    }))
});
