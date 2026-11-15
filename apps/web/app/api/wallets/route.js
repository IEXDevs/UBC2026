export const runtime = 'nodejs';

import { createPrivyWalletClient, sanitizeOrigin } from '@ubc2026/wallets/privy';
import { readRootEnv } from '../../../lib/root-env.mjs';
import { missingWalletSecrets, resolvePrivyAppId } from '../../../lib/wallet-provision.mjs';

function requestOrigin(request) {
  const fromOrigin = sanitizeOrigin(request.headers.get('origin'));
  if (fromOrigin) return fromOrigin;
  const referer = request.headers.get('referer');
  if (typeof referer === 'string' && referer.trim()) {
    try { return sanitizeOrigin(new URL(referer.trim()).origin); } catch { /* ignore */ }
  }
  return 'http://localhost:3000';
}

function publicWallet(wallet) {
  return {
    id: wallet.id,
    ownerId: wallet.ownerId,
    kind: wallet.kind,
    label: wallet.label,
    address: wallet.address,
    frozen: wallet.frozen,
    provider: wallet.provider,
  };
}

function rootWalletEnv() {
  return {
    PRIVY_APP_ID: readRootEnv('PRIVY_APP_ID'),
    PRIVY_APP_SECRET: readRootEnv('PRIVY_APP_SECRET'),
    QUICKNODE_DEVNET_RPC_URL: readRootEnv('QUICKNODE_DEVNET_RPC_URL'),
    PRIVY_AUTHORIZATION_KEY: readRootEnv('PRIVY_AUTHORIZATION_KEY'),
    NEXT_PUBLIC_PRIVY_APP_ID: readRootEnv('NEXT_PUBLIC_PRIVY_APP_ID'),
  };
}

/** Prefer duck-typing — `instanceof` fails when the wallets package is duplicated. */
function walletErrorFields(error) {
  if (!error || typeof error !== 'object') return null;
  if (error.name !== 'WalletError' && error.constructor?.name !== 'WalletError') return null;
  const code = typeof error.code === 'string' && /^[a-z0-9_]{1,64}$/.test(error.code) ? error.code : 'wallet_failed';
  const detail = typeof error.message === 'string'
    ? error.message.replace(/[\r\n]+/g, ' ').slice(0, 180)
    : undefined;
  return { code, detail };
}

/** Config presence only — no secret values. */
export async function GET() {
  const env = rootWalletEnv();
  return Response.json({
    hasAppId: Boolean(resolvePrivyAppId(env)),
    hasAppSecret: Boolean(env.PRIVY_APP_SECRET),
    hasRpc: Boolean(env.QUICKNODE_DEVNET_RPC_URL),
    hasAuthorizationKey: Boolean(env.PRIVY_AUTHORIZATION_KEY),
    missing: missingWalletSecrets(env),
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request) {
  const header = request.headers.get('authorization') ?? '';
  const accessToken = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!accessToken) {
    return Response.json({ error: 'login_required' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }

  const env = rootWalletEnv();
  const missing = missingWalletSecrets(env);
  if (missing.length > 0) {
    return Response.json(
      { error: 'missing_config', missing },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const client = createPrivyWalletClient({
      appId: resolvePrivyAppId(env),
      appSecret: env.PRIVY_APP_SECRET,
      // acceptLogin does not call RPC; allow empty and require it only for signing routes.
      rpcUrl: env.QUICKNODE_DEVNET_RPC_URL || null,
      authorizationKey: env.PRIVY_AUTHORIZATION_KEY || null,
    });
    const ownerHeader = request.headers.get('x-owner-id');
    const result = await client.acceptLogin({
      accessToken,
      origin: requestOrigin(request),
      ownerId: typeof ownerHeader === 'string' && ownerHeader.trim() ? ownerHeader.trim() : undefined,
    });
    const wallets = [result.main, ...result.additional].filter(Boolean).map(publicWallet);
    // Workers strip Origin on outbound Privy calls, so persist rows directly into Supabase.
    const runtime = readRootEnv('NEXT_PUBLIC_AGENT_RUNTIME_URL');
    if (runtime && typeof runtime === 'string' && runtime.trim() && wallets.length) {
      try {
        const base = new URL(runtime.trim());
        if (base.protocol === 'https:' || base.protocol === 'http:') {
          await fetch(new URL('/api/wallets/persist', base), {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'content-type': 'application/json',
              ...(typeof ownerHeader === 'string' && ownerHeader.trim()
                ? { 'x-owner-id': ownerHeader.trim() }
                : {}),
            },
            body: JSON.stringify({ wallets }),
            cache: 'no-store',
          }).catch(() => null);
        }
      } catch {
        /* local Privy wallets still return below */
      }
    }
    return Response.json({
      created: result.created === true,
      wallets,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const fields = walletErrorFields(error);
    const code = fields?.code || 'wallet_failed';
    const status = code === 'missing_config' || code === 'invalid_rpc' || code === 'missing_origin' ? 503 : 502;
    const detail = fields?.detail
      || (typeof error?.message === 'string' ? error.message.replace(/[\r\n]+/g, ' ').slice(0, 180) : undefined);
    const payload = detail ? { error: code, detail } : { error: code };
    console.error('[api/wallets]', payload);
    return Response.json(payload, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
