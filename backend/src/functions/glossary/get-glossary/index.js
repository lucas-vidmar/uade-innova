import { app } from '@azure/functions';
import { withAuth } from '../../../middleware/with-auth.js';
import { withCorrelation } from '../../../middleware/with-correlation.js';
import { validateFrontDoorId, parseClientPrincipal } from '../../../services/auth-utils.js';
import { getGlossary, findGlossaryTerm } from '../../../services/glossary-store.js';

app.http('get-glossary', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'glossary',
  handler: withCorrelation(withAuth(async (request, context) => {
    if (!validateFrontDoorId(request)) {
      return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } }) };
    }

    const principal = parseClientPrincipal(request);
    const subjectId = request.query.get('subjectId');
    if (!subjectId) {
      return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: { code: 'INVALID_INPUT', message: 'subjectId is required' } }) };
    }

    // Story 11.1.6: lookup de un término puntual del glosario.
    // GET /api/glossary?subjectId={id}&term={term}
    const term = request.query.get('term');
    if (term && term.trim()) {
      try {
        const found = await findGlossaryTerm(subjectId, term.trim());
        return {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            data: {
              found: Boolean(found),
              term: found ? { term: found.term, aliases: found.aliases, definition: found.definition || '' } : null,
            },
          }),
        };
      } catch (err) {
        context.error(`[get-glossary] Error lookup term:`, err);
        return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }) };
      }
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
  })),
});
