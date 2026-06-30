import { v4 as uuidv4 } from 'uuid';
import { resolveCorrelationId, resolveTraceContext, buildDependencyHeaders, withCorrelationResponseHeaders, generateCorrelationId } from '../services/correlation.js';

const ALLOWED_ORIGINS = [
  'https://agreeable-beach-002ff0c0f.6.azurestaticapps.net',
  'http://localhost:4280',
  'http://localhost:5173',
];

function getCorsHeaders(request) {
  const origin = request.headers.get('origin') || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : '';
  if (!allowedOrigin) return {};
  return {
    'access-control-allow-origin': allowedOrigin,
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    'access-control-allow-headers': 'content-type,authorization,x-correlation-id,x-mock-role,x-edu-uid,traceparent,tracestate',
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

    const result = await handler(request, context);

    if (result && typeof result === 'object') {
      const existingHeaders = result.headers || {};
      result.headers = withCorrelationResponseHeaders(correlationId, traceContext, existingHeaders);
      addCorsHeaders(result, request);
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
