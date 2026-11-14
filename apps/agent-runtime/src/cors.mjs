/**
 * Browser CORS for the glass shell talking to this Worker.
 * Custom headers like `x-owner-id` trigger an OPTIONS preflight from localhost.
 */

const DEFAULT_ORIGINS = Object.freeze([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

const ALLOW_HEADERS = [
  'Authorization',
  'Content-Type',
  'x-owner-id',
  'x-elevenlabs-webhook-secret',
].join(', ');

const ALLOW_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';

export function corsOriginList(env = {}) {
  const extra = typeof env.CORS_ORIGINS === 'string' ? env.CORS_ORIGINS : '';
  const fromEnv = extra
    .split(/[\s,]+/)
    .map(value => value.trim())
    .filter(Boolean);
  return [...new Set([...DEFAULT_ORIGINS, ...fromEnv])];
}

export function allowedCorsOrigin(request, env = {}) {
  const origin = request.headers.get('Origin');
  if (!origin || origin.length > 256 || /[\r\n]/.test(origin)) return null;
  return corsOriginList(env).includes(origin) ? origin : null;
}

export function corsHeaders(request, env = {}) {
  const origin = allowedCorsOrigin(request, env);
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': ALLOW_METHODS,
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function corsPreflightResponse(request, env = {}) {
  const headers = corsHeaders(request, env);
  if (!headers['Access-Control-Allow-Origin']) {
    return new Response(null, { status: 403 });
  }
  return new Response(null, { status: 204, headers });
}

export function withCors(request, response, env = {}) {
  const headers = corsHeaders(request, env);
  if (!headers['Access-Control-Allow-Origin']) return response;
  const next = new Headers(response.headers);
  for (const [name, value] of Object.entries(headers)) next.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: next,
  });
}
