import { proxyPrivyAuth } from '../../../../lib/privy-auth-proxy.mjs';

export const runtime = 'nodejs';

async function handle(request, context) {
  const params = await context?.params;
  const parts = Array.isArray(params?.path) ? params.path : [];
  const path = `/${parts.map((part) => {
    try { return decodeURIComponent(part); } catch { return ''; }
  }).join('/')}`;
  return proxyPrivyAuth(request, path);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
