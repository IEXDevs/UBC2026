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

// Privy's browser SDK uses PATCH to enroll additional signers on a wallet.
export async function PATCH(request, context) {
  const parts = (await context?.params)?.path;
  if (!Array.isArray(parts) || parts.length !== 4 || parts[0] !== 'api' || parts[1] !== 'v1'
      || parts[2] !== 'wallets' || !/^[A-Za-z0-9_-]{8,128}$/.test(parts[3])) {
    return Response.json({ error: 'not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  return handle(request, context);
}
