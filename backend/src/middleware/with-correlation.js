import { v4 as uuidv4 } from 'uuid';
import { resolveCorrelationId, resolveTraceContext, buildDependencyHeaders, withCorrelationResponseHeaders, generateCorrelationId } from '../services/correlation.js';

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
