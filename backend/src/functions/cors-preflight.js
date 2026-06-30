import { app } from '@azure/functions';

const ALLOWED_ORIGINS = [
  'https://agreeable-beach-002ff0c0f.6.azurestaticapps.net',
  'http://localhost:4280',
  'http://localhost:5173',
];

function buildCorsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : (ALLOWED_ORIGINS[0]);
  return {
    'access-control-allow-origin': allowedOrigin,
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    'access-control-allow-headers': 'content-type,authorization,x-correlation-id,x-mock-role,x-edu-uid,traceparent,tracestate',
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
