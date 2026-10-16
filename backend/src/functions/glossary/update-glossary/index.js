import { app } from '@azure/functions';
import { withCorrelation } from '../../../middleware/with-correlation.js';
import { withAuth } from '../../../middleware/with-auth.js';
import { validateFrontDoorId, parseClientPrincipal } from '../../../services/auth-utils.js';
import { updateGlossary, GlossaryValidationError } from '../../../services/glossary-store.js';

app.http('update-glossary', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'glossary',
  handler: withCorrelation(withAuth(async (request, context) => {
    if (!validateFrontDoorId(request)) {
      return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } }) };
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: { code: 'INVALID_INPUT', message: 'El cuerpo debe ser JSON válido.' } }) };
    }

    const { subjectId, terms } = body || {};
    if (!subjectId || !Array.isArray(terms)) {
      return { status: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: { code: 'INVALID_INPUT', message: 'subjectId y terms son requeridos.' } }) };
    }

    try {
      // UJ-16 paso 8: el vocabulario tiene responsable, no sólo contenido.
      const principal = parseClientPrincipal(request);
      const updatedBy = principal?.userId || principal?.oid || '';
      const data = await updateGlossary(subjectId, terms, updatedBy);
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, data }),
      };
    } catch (err) {
      // UJ-16 paso 4: los choques se resuelven antes de poner el vocabulario en
      // vigencia, con el detalle de qué filas se contradicen.
      if (err instanceof GlossaryValidationError || err?.code === 'GLOSSARY_VALIDATION') {
        return {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: { code: 'GLOSSARY_VALIDATION', message: err.message }, conflicts: err.conflicts || [] }),
        };
      }
      context.error(`[update-glossary] Error:`, err);
      return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }) };
    }
  }, { roles: ['Docente', 'Director'] })),
});
