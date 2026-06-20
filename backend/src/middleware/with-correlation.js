import { resolveCorrelationId, resolveTraceContext, buildDependencyHeaders, withCorrelationResponseHeaders } from '../services/correlation.js';

export function withCorrelation(handler) {
  return async (request, context) => {
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
    }

    return result;
  };
}
