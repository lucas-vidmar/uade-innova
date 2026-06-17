import { app } from '@azure/functions';
import { validateFrontDoorId, parseClientPrincipal } from '../../../services/auth-utils.js';
import { getEnrollment } from '../../../services/state-store.js';
import { updateGlossary } from '../../../services/glossary-store.js';

app.http('update-glossary', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'glossary',
  handler: async (request, context) => {
    if (!validateFrontDoorId(request)) {
      return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } }) };
    }

    const principal = parseClientPrincipal(request);
    const isTeacher = process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Development'
      || principal?.userRoles?.includes('Docente')
      || principal?.userRoles?.includes('Director');

    if (!isTeacher) {
      return { status: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: { code: 'FORBIDDEN', message: 'Acceso denegado. Se requiere rol Docente o Director.' } }) };
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
      const data = await updateGlossary(subjectId, terms);
      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, data }),
      };
    } catch (err) {
      context.error(`[update-glossary] Error:`, err);
      return { status: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }) };
    }
  },
});
