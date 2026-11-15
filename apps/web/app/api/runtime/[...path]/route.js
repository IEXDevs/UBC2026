import { readRootEnv } from '../../../../lib/root-env.mjs';
import { runtimeProxyTarget } from '../../../../lib/runtime-proxy.mjs';

export const runtime = 'nodejs';

const METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE']);

function noStore(body, status) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function runtimeOrigin() {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const ctx = await getCloudflareContext({ async: true });
    const bound = ctx?.env?.NEXT_PUBLIC_AGENT_RUNTIME_URL;
    if (typeof bound === 'string' && bound.trim()) return bound.trim();
  } catch {
    /* `next dev` has no Worker binding. Root .env.local still applies. */
  }
  const fromFile = readRootEnv('NEXT_PUBLIC_AGENT_RUNTIME_URL');
  if (fromFile) return fromFile;
  return typeof process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL === 'string'
    ? process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL.trim()
    : '';
}

async function proxy(request, context) {
  if (!METHODS.has(request.method)) return noStore({ error: 'method_not_allowed' }, 405);
  const params = await context?.params;
  const parts = Array.isArray(params?.path) ? params.path : [];
  const pathname = `/${parts.map((part) => {
    try { return decodeURIComponent(part); } catch { return ''; }
  }).join('/')}`;
  const target = runtimeProxyTarget(await runtimeOrigin(), pathname, new URL(request.url).search);
  if (target.error === 'runtime_unconfigured') {
    return noStore({ ok: false, error: 'runtime_unconfigured', source: 'unconfigured' }, 503);
  }
  if (target.error) return noStore({ error: 'not_found' }, 404);

  const headers = new Headers();
  const auth = request.headers.get('authorization');
  const owner = request.headers.get('x-owner-id');
  const contentType = request.headers.get('content-type');
  // Privy users/me on the Worker needs a browser Origin (wallet create).
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  if (auth && auth.length < 12000) headers.set('authorization', auth);
  if (owner && owner.length < 300) headers.set('x-owner-id', owner);
  if (contentType && contentType.length < 200) headers.set('content-type', contentType);
  if (origin && origin.length < 300 && !/[\r\n]/.test(origin)) {
    headers.set('origin', origin);
    headers.set('x-maelstrom-origin', origin);
  } else if (referer && referer.length < 500 && !/[\r\n]/.test(referer)) {
    headers.set('referer', referer);
    try {
      const fromReferer = new URL(referer).origin;
      if (fromReferer.length < 300) headers.set('x-maelstrom-origin', fromReferer);
    } catch { /* ignore bad referer */ }
  }

  const init = { method: request.method, headers, redirect: 'error', cache: 'no-store' };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const buf = await request.arrayBuffer();
    if (buf.byteLength > 1_000_000) return noStore({ error: 'body_too_large' }, 413);
    if (buf.byteLength) init.body = buf;
  }

  try {
    const upstream = await fetch(target.url, init);
    const body = await upstream.arrayBuffer();
    const out = new Headers({ 'Cache-Control': 'no-store' });
    const type = upstream.headers.get('content-type');
    if (type && type.length < 200) out.set('content-type', type);
    return new Response(body, { status: upstream.status, headers: out });
  } catch {
    return noStore({ error: 'runtime_unreachable' }, 502);
  }
}

export function GET(request, context) { return proxy(request, context); }
export function POST(request, context) { return proxy(request, context); }
export function PUT(request, context) { return proxy(request, context); }
export function DELETE(request, context) { return proxy(request, context); }
