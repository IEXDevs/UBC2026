export const runtime = 'nodejs';

import { accountWriteBodies } from '@ubc2026/wallets';
import { createPrivyWalletClient } from '@ubc2026/wallets/privy';
import { readRootEnv } from '../../../lib/root-env.mjs';
import { fetchAgentRuntime } from '../../../lib/runtime-fetch.mjs';
import { missingWalletSecrets, resolvePrivyAppId, walletConfigFlags } from '../../../lib/wallet-provision.mjs';
import {
  publicWallet,
  requestOrigin,
  walletErrorFields,
  walletErrorStatus,
} from '../../../lib/wallets-route.mjs';

async function persistAccount(login, ownerId) {
  const url = readRootEnv('SUPABASE_URL');
  const key = readRootEnv('SUPABASE_SERVICE_ROLE_KEY');
  const bodies = accountWriteBodies(login, ownerId);
  if (!url || !key || !bodies) return;
  let origin;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return;
    origin = parsed.origin;
  } catch {
    return;
  }
  const headers = {
    apikey: key,
    authorization: `Bearer ${key}`,
    accept: 'application/json',
    'content-type': 'application/json',
    prefer: 'resolution=merge-duplicates,return=minimal',
  };
  async function write(path, body) {
    const response = await fetch(`${origin}/rest/v1/${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      redirect: 'error',
    });
    return response.ok;
  }
  const userOk = await write('users', bodies.user);
  if (!userOk) {
    const { login_methods, ...core } = bodies.user;
    await write('users', core);
  }
  if (bodies.wallets.length) {
    const walletsOk = await write('wallets', bodies.wallets);
    if (!walletsOk) {
      await write('wallets', bodies.wallets.map(({ spendable, ...row }) => row));
    }
  }
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

/** Config presence only — no secret values. */
export async function GET() {
  const env = {
    ...rootWalletEnv(),
    NEXT_PUBLIC_AGENT_RUNTIME_URL: readRootEnv('NEXT_PUBLIC_AGENT_RUNTIME_URL'),
  };
  return Response.json(walletConfigFlags(env), { headers: { 'Cache-Control': 'no-store' } });
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
    const ownerId = typeof ownerHeader === 'string' && ownerHeader.trim()
      ? ownerHeader.trim()
      : result.main?.ownerId;
    try {
      await persistAccount(result, ownerId);
    } catch {
      console.error('[api/wallets]', 'account_persist_failed');
    }
    const wallets = [result.main, ...result.additional].filter(Boolean).map(publicWallet);
    const runtime = readRootEnv('NEXT_PUBLIC_AGENT_RUNTIME_URL');
    if (runtime && typeof runtime === 'string' && runtime.trim() && wallets.length) {
      try {
        const base = new URL(runtime.trim());
        if (base.protocol === 'https:' || base.protocol === 'http:') {
          await fetchAgentRuntime(new URL('/api/wallets/persist', base), {
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
      loginMethods: result.loginMethods || [],
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const fields = walletErrorFields(error);
    const code = fields?.code || 'wallet_failed';
    const status = walletErrorStatus(code);
    const detail = fields?.detail
      || (typeof error?.message === 'string' ? error.message.replace(/[\r\n]+/g, ' ').slice(0, 180) : undefined);
    const payload = detail ? { error: code, detail } : { error: code };
    console.error('[api/wallets]', payload);
    return Response.json(payload, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
