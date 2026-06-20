import { app } from '@azure/functions';
import { withCorrelation } from '../../../middleware/with-correlation.js';
import { validateFrontDoorId, parseClientPrincipal } from '../../../services/auth-utils.js';
import { getTableClient } from '../../../services/storage.js';
import { getEnrollment } from '../../../services/state-store.js';

const CORRECTIONS_TABLE = process.env.AZURE_TABLE_TRANSCRIPTION_CORRECTIONS || 'TranscriptionCorrections';

app.http('get-transcription-suggestions', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'corrections-transcription',
  handler: withCorrelation(async (request, context) => {
    if (!validateFrontDoorId(request)) {
      return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } }) };
    }

    const principal = parseClientPrincipal(request);
    const subjectId = request.query.get('subjectId');
    const statusFilter = request.query.get('status') || 'pending';

    if (!subjectId) {
      return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: { code: 'INVALID_INPUT', message: 'subjectId is required' } }) };
    }

    try {
      const client = getTableClient(CORRECTIONS_TABLE);
      await client.createTable().catch(() => {});
      const filter = `PartitionKey eq '${subjectId.replace(/'/g, "''")}'`;
      const entities = [];
      for await (const entity of client.listEntities({ queryOptions: { filter } })) {
        if (statusFilter === 'all' || entity.status === statusFilter) {
          entities.push(entity);
        }
      }
      entities.sort((a, b) => new Date(b.detectedAt || 0) - new Date(a.detectedAt || 0));

      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, data: entities }),
      };
    } catch (err) {
      context.error(`[get-transcription-suggestions] Error:`, err);
      return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }) };
    }
  }),
});
