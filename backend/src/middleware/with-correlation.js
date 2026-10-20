import { v4 as uuidv4 } from 'uuid';
import { resolveCorrelationId, resolveTraceContext, buildDependencyHeaders, withCorrelationResponseHeaders, generateCorrelationId } from '../services/correlation.js';
import { traceAccess } from './with-access-trace.js';

const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:4280,http://localhost:5173').split(',');

function getCorsHeaders(request) {
  const origin = request?.headers?.get?.('origin') || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin) ? origin : '';
  if (!allowedOrigin) return {};
  return {
    'access-control-allow-origin': allowedOrigin,
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    'access-control-allow-headers': 'content-type,authorization,x-correlation-id,x-mock-role,x-edu-uid,x-ms-client-principal-name,traceparent,tracestate',
    // #411: la correlación viaja en la respuesta, pero en un origen distinto el
    // navegador sólo expone las cabeceras de la lista segura de CORS. Sin esta
    // lista, ninguna pantalla puede leer x-correlation-id y nadie puede citar la
    // correlación de un fallo al reportarlo.
    'access-control-expose-headers': 'x-correlation-id,traceparent,tracestate',
    'access-control-max-age': '86400',
    'vary': 'Origin',
  };
}

function addCorsHeaders(response, request) {
  if (!response || typeof response !== 'object') return response;
  const corsHeaders = getCorsHeaders(request);
  const existingHeaders = response.headers || {};
  response.headers = { ...corsHeaders, ...existingHeaders };
  return response;
}

function handleOptions(request) {
  const corsHeaders = getCorsHeaders(request);
  if (Object.keys(corsHeaders).length === 0) {
    return { status: 404, body: '' };
  }
  return { status: 204, headers: corsHeaders, body: '' };
}

export function withCorrelation(handler) {
  return async (request, context) => {
    // Handle CORS preflight directly — do not invoke the handler
    if (request.method === 'OPTIONS') {
      return handleOptions(request);
    }

    const correlationId = resolveCorrelationId(request);
    const traceContext = resolveTraceContext(request);
    const dependencyHeaders = buildDependencyHeaders(correlationId, traceContext);

    context.correlationId = correlationId;
    context.traceContext = traceContext;
    context.dependencyHeaders = dependencyHeaders;

    // #456: todo pedido HTTP queda asentado en el rastro de accesos (entregado,
    // denegado o con error). Es el único punto que ve request + respuesta de las
    // 149 superficies; `traceAccess` no lanza nunca.
    const startedAt = Date.now();
    let result;
    try {
      result = await handler(request, context);
    } catch (err) {
      await traceAccess({ request, context, response: null, startedAt, thrown: err });
      throw err;
    }

    if (result && typeof result === 'object') {
      const existingHeaders = result.headers || {};
      result.headers = withCorrelationResponseHeaders(correlationId, traceContext, existingHeaders);
      addCorsHeaders(result, request);
    }

    const trace = await traceAccess({ request, context, response: result, startedAt });
    // Si el asiento no se pudo escribir, la respuesta lo declara: un rastro
    // vacío nunca debe leerse como "no hubo pedidos".
    if (trace && trace.recorded === false && result && typeof result === 'object' && trace.error !== 'no trazado') {
      result.headers = { ...(result.headers || {}), 'x-access-audit': 'not-recorded' };
    }

    return result;
  };
}

export function withCorrelationTimer(handler) {
  return async (myTimer, context) => {
    if (!context || typeof context !== 'object') {
      throw new Error('withCorrelationTimer requires a valid context object');
    }

    const correlationId = generateCorrelationId() || uuidv4();
    const traceContext = resolveTraceContext({ headers: { get: () => null } });

    context.correlationId = correlationId;
    context.traceContext = traceContext;
    context.dependencyHeaders = buildDependencyHeaders(correlationId, traceContext);

    return handler(myTimer, context);
  };
}
