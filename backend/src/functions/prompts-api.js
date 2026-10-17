import { app } from '@azure/functions';
import { withCorrelation } from '../middleware/with-correlation.js';
import { withAuth } from '../middleware/with-auth.js';
import { parseClientPrincipal, validateFrontDoorId } from '../services/auth-utils.js';
import { structuredErrorResponse, ErrorCategory } from '../services/error-categories.js';
import {
  listTypes,
  listVersions,
  getActive,
  getVersion,
  createVersion,
  updateVersion,
  activateVersion,
  deleteVersion,
} from '../services/prompt-store.js';

function jsonResponse(status, payload) {
  return {
    status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function directorDenied() {
  return structuredErrorResponse(
    403,
    'Forbidden - Se requiere rol Director o Admin para gestionar prompts.',
    ErrorCategory.AUTH,
    'FORBIDDEN',
  );
}

function requireDirector(request, context) {
  if (!validateFrontDoorId(request)) return null;
  const principal = context?.principal || parseClientPrincipal(request);
  if (!principal?.userRoles?.includes('Director') && !principal?.userRoles?.includes('Admin')) {
    return null;
  }
  return principal;
}

/**
 * Docente/Director/Admin: quién enseña necesita poder **enumerar** las versiones
 * del prompt del asistente para poder enfrentar la vigente contra una propuesta
 * en el banco de pruebas (UJ-49). Sólo metadatos — el contenido sigue restringido
 * a Director/Admin como hasta ahora.
 */
function requireTeacherOrDirector(request, context) {
  if (!validateFrontDoorId(request)) return null;
  const principal = context?.principal || parseClientPrincipal(request);
  const roles = principal?.userRoles || [];
  if (!roles.includes('Docente') && !roles.includes('Director') && !roles.includes('Admin')) {
    return null;
  }
  return principal;
}

function teacherDenied() {
  return structuredErrorResponse(
    403,
    'Forbidden - Se requiere rol Docente, Director o Admin para ver las versiones disponibles del prompt.',
    ErrorCategory.AUTH,
    'FORBIDDEN',
  );
}

app.http('prompts-list-types', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'prompts',
  handler: withCorrelation(withAuth(async (request, context) => {
    const principal = requireDirector(request, context);
    if (!principal) return directorDenied();
    try {
      const types = await listTypes();
      const result = [];
      for (const t of types) {
        const active = await getActive(t.id);
        const versions = await listVersions(t.id);
        result.push({
          ...t,
          activeVersion: active ? active.versionId : null,
          activeDescription: active ? active.description : null,
          versionCount: versions.length,
          activeContent: active?.content || null,
          activeSystemPrompt: active?.systemPrompt || null,
          activeUserPromptTemplate: active?.userPromptTemplate || null,
          activeVariables: active?.variables || [],
          activeModel: active?.model || null,
        });
      }
      return jsonResponse(200, result);
    } catch (err) {
      return jsonResponse(500, { error: err.message });
    }
  }, { roles: ['Director', 'Admin'] })),
});

app.http('prompts-list-versions', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'prompts/{type}',
  handler: withCorrelation(withAuth(async (request, context) => {
    const principal = requireDirector(request, context);
    if (!principal) return directorDenied();
    const type = request.params.type;
    try {
      const versions = await listVersions(type);
      return jsonResponse(200, versions);
    } catch (err) {
      return jsonResponse(400, { error: err.message });
    }
  }, { roles: ['Director', 'Admin'] })),
});

app.http('prompts-get-active', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'prompts/{type}/active',
  handler: withCorrelation(withAuth(async (request, context) => {
    const principal = requireDirector(request, context);
    if (!principal) return directorDenied();
    const type = request.params.type;
    try {
      const active = await getActive(type);
      if (!active) return jsonResponse(404, { error: `No hay versión activa para tipo "${type}"` });
      return jsonResponse(200, active);
    } catch (err) {
      return jsonResponse(400, { error: err.message });
    }
  }, { roles: ['Director', 'Admin'] })),
});

app.http('prompts-list-available', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'prompts/{type}/available',
  handler: withCorrelation(withAuth(async (request, context) => {
    const principal = requireTeacherOrDirector(request, context);
    if (!principal) return teacherDenied();
    const type = request.params.type;
    try {
      const versions = await listVersions(type);
      // Sólo metadatos: quién enseña necesita saber QUÉ versiones puede enfrentar
      // y cuál rige, no leer su contenido (UJ-49 pasos 2 y 4).
      const metadata = versions.map((v) => ({
        versionId: v.versionId,
        isActive: !!v.isActive,
        description: v.description || '',
        createdAt: v.createdAt || null,
        model: v.model || null,
      }));
      const active = metadata.find((v) => v.isActive) || null;
      return jsonResponse(200, {
        type,
        activeVersion: active ? active.versionId : null,
        versions: metadata,
      });
    } catch (err) {
      return jsonResponse(400, { error: err.message });
    }
  }, { roles: ['Docente', 'Director', 'Admin'] })),
});

app.http('prompts-create', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'prompts',
  handler: withCorrelation(withAuth(async (request, context) => {
    const principal = requireDirector(request, context);
    if (!principal) return directorDenied();
    try {
      const body = await request.json();
      const { type, content, systemPrompt, userPromptTemplate, variables, description, model } = body;
      if (!type) return jsonResponse(400, { error: 'El campo "type" es requerido' });

      const result = await createVersion({
        type,
        content: content || '',
        systemPrompt: systemPrompt || '',
        userPromptTemplate: userPromptTemplate || '',
        variables: variables || [],
        description: description || '',
        createdBy: principal.userId || 'director',
        model: model || null,
      });

      context.log(`[Prompts] Nueva versión creada: type=${type}, versionId=${result.versionId}`);
      return jsonResponse(201, result);
    } catch (err) {
      return jsonResponse(400, { error: err.message });
    }
  }, { roles: ['Director', 'Admin'] })),
});

app.http('prompts-update', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'prompts/{type}/{versionId}',
  handler: withCorrelation(withAuth(async (request, context) => {
    const principal = requireDirector(request, context);
    if (!principal) return directorDenied();
    const { type, versionId } = request.params;
    try {
      const body = await request.json();
      const result = await updateVersion(type, versionId, {
        content: body.content,
        systemPrompt: body.systemPrompt,
        userPromptTemplate: body.userPromptTemplate,
        variables: body.variables,
        description: body.description,
        model: body.model,
        updatedBy: principal.userId || 'director',
      });
      return jsonResponse(200, result);
    } catch (err) {
      return jsonResponse(400, { error: err.message });
    }
  }, { roles: ['Director', 'Admin'] })),
});

app.http('prompts-activate', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'prompts/{type}/activate/{versionId}',
  handler: withCorrelation(withAuth(async (request, context) => {
    const principal = requireDirector(request, context);
    if (!principal) return directorDenied();
    const { type, versionId } = request.params;
    // El paso de una versión a otra tiene que quedar asentado con su motivo:
    // sin motivo no se activa, para que después se pueda reconstruir por qué
    // se cambió y por qué se volvió atrás (UJ-48 pasos 5 y 9).
    let reason = '';
    try {
      const body = await request.json();
      reason = String(body?.reason || '').trim();
    } catch (err) {
      reason = '';
    }
    if (!reason) {
      return jsonResponse(400, {
        error: 'ACTIVATION_REASON_REQUIRED',
        message: 'Indicá el motivo de la activación: queda registrado junto con quién y cuándo.',
      });
    }
    try {
      const result = await activateVersion(type, versionId, {
        activatedBy: principal.userId || 'director',
        reason,
      });
      context.log(`[Prompts] Versión activada: type=${type}, versionId=${versionId}, by=${principal.userId || 'director'}, reason=${reason}`);
      return jsonResponse(200, result);
    } catch (err) {
      return jsonResponse(400, { error: err.message });
    }
  }, { roles: ['Director', 'Admin'] })),
});

app.http('prompts-delete', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'prompts/{type}/{versionId}',
  handler: withCorrelation(withAuth(async (request, context) => {
    const principal = requireDirector(request, context);
    if (!principal) return directorDenied();
    const { type, versionId } = request.params;
    try {
      const result = await deleteVersion(type, versionId);
      return jsonResponse(200, result);
    } catch (err) {
      return jsonResponse(400, { error: err.message });
    }
  }, { roles: ['Director', 'Admin'] })),
});
