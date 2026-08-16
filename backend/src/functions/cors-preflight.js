import { app } from '@azure/functions';

const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:4280,http://localhost:5173').split(',');

function buildCorsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin) ? origin : (ALLOWED_ORIGINS[0]);
  return {
    'access-control-allow-origin': allowedOrigin,
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    'access-control-allow-headers': 'content-type,authorization,x-correlation-id,x-mock-role,x-edu-uid,x-ms-client-principal-name,traceparent,tracestate',
    'access-control-max-age': '86400',
    'vary': 'Origin',
  };
}

app.http('cors-preflight', {
  methods: ['OPTIONS'],
  authLevel: 'anonymous',
  route: '{*path}',
  handler: async (request) => {
    const origin = request.headers.get('origin') || '';
    const headers = buildCorsHeaders(origin);
    return { status: 204, headers, body: '' };
  }
});
