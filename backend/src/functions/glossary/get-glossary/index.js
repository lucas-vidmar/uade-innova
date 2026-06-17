import { app } from '@azure/functions';
import { validateFrontDoorId, parseClientPrincipal } from '../../../services/auth-utils.js';
import { getGlossary } from '../../../services/glossary-store.js';

app.http('get-glossary', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'glossary',
  handler: async (request, context) => {
    if (!validateFrontDoorId(request)) {
      return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } }) };
    }

    const principal = parseClientPrincipal(request);
    const subjectId = request.query.get('subjectId');
    if (!subjectId) {
      return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: { code: 'INVALID_INPUT', message: 'subjectId is required' } }) };
    }

    try {
      const glossary = await getGlossary(subjectId);
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, data: glossary }),
      };
    } catch (err) {
      context.error(`[get-glossary] Error:`, err);
      return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }) };
    }
  },
});
