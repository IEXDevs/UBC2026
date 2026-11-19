export const runtime = 'nodejs';

import { accountWriteBodies } from '@ubc2026/wallets';
import { createPrivyWalletClient } from '@ubc2026/wallets/privy';
import { accessTokenFromRequest } from '../../../lib/privy-cookie-session.mjs';
import { readRootEnv } from '../../../lib/root-env.mjs';
import { fetchAgentRuntime } from '../../../lib/runtime-fetch.mjs';
import { missingWalletSecrets, resolvePrivyAppId, walletConfigFlags } from '../../../lib/wallet-provision.mjs';
import {
  cloudflareWorkerEnv,
  hasAgentRuntimeBinding,
  mapRuntimeWalletCreate,
  safeFetchErrorDetail,
} from '../../../lib/wallets-cloudflare.mjs';
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
      redirect: 'manual',
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

/**
 * Hosted OpenNext often TypeErrors on outbound Privy fetch. Prefer the
 * AGENT_RUNTIME service binding (native workerd fetch) when available.
 */
async function provisionViaAgentRuntime(request, accessToken) {
  const runtime = readRootEnv('NEXT_PUBLIC_AGENT_RUNTIME_URL');
  if (!runtime || typeof runtime !== 'string' || !runtime.trim()) {
    return null;
  }
  let base;
  try {
    base = new URL(runtime.trim());
  } catch {
    return null;
  }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') return null;

  const ownerHeader = request.headers.get('x-owner-id');
  const upstream = await fetchAgentRuntime(new URL('/api/wallets', base), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
      'content-type': 'application/json',
      ...(typeof ownerHeader === 'string' && ownerHeader.trim()
        ? { 'x-owner-id': ownerHeader.trim() }
        : {}),
    },
    body: '{}',
    cache: 'no-store',
  });
  const body = await upstream.json().catch(() => ({}));
  const mapped = mapRuntimeWalletCreate(body);
  if (mapped.error) {
    return Response.json(mapped, {
      status: upstream.status >= 400 ? upstream.status : walletErrorStatus(mapped.error),
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  return Response.json({
    created: mapped.created === true,
    wallets: mapped.wallets,
    loginMethods: mapped.loginMethods,
    via: 'agent-runtime',
  }, {
    status: upstream.ok ? 200 : (upstream.status || 502),
    headers: { 'Cache-Control': 'no-store' },
  });
}

/** Config presence only — no secret values. Optional ?probe=1 hits Privy. */
export async function GET(request) {
  const env = {
    ...rootWalletEnv(),
    NEXT_PUBLIC_AGENT_RUNTIME_URL: readRootEnv('NEXT_PUBLIC_AGENT_RUNTIME_URL'),
  };
  const flags = walletConfigFlags(env);
  let probeRequested = false;
  try {
    const href = typeof request?.url === 'string' ? request.url : '';
    if (href) probeRequested = new URL(href).searchParams.get('probe') === '1';
  } catch {
    probeRequested = false;
  }
  if (!probeRequested) {
    return Response.json(flags, { headers: { 'Cache-Control': 'no-store' } });
  }

  const cfEnv = await cloudflareWorkerEnv();
  const probe = {
    onCloudflare: Boolean(cfEnv),
    hasRuntimeBinding: hasAgentRuntimeBinding(cfEnv),
    privyReachable: false,
    privyStatus: null,
    privyError: null,
  };
  const appId = resolvePrivyAppId(env);
  const secret = env.PRIVY_APP_SECRET;
  if (appId && secret) {
    try {
      const auth = Buffer.from(`${appId}:${secret}`, 'utf8').toString('base64');
      const response = await fetch('https://api.privy.io/v1/users/did:privy:probe_connectivity_check', {
        method: 'GET',
        headers: {
          Authorization: `Basic ${auth}`,
          'privy-app-id': appId,
          accept: 'application/json',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined,
      });
      probe.privyStatus = response.status;
      // 401/404 from Privy still means TCP/TLS/HTTP to api.privy.io worked.
      probe.privyReachable = response.status > 0;
    } catch (error) {
      probe.privyError = safeFetchErrorDetail(error).slice(0, 160);
    }
  }
  return Response.json({ ...flags, probe }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request) {
  const accessToken = accessTokenFromRequest(request);
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

  const cfEnv = await cloudflareWorkerEnv();
  const onCloudflareWorker = Boolean(cfEnv);
  if (onCloudflareWorker && hasAgentRuntimeBinding(cfEnv)) {
    try {
      const proxied = await provisionViaAgentRuntime(request, accessToken);
      if (proxied) return proxied;
    } catch (error) {
      console.error('[api/wallets]', {
        error: 'runtime_proxy_failed',
        detail: safeFetchErrorDetail(error, { label: 'Agent runtime' }),
      });
      // Fall through to local Privy path so localhost-shaped errors still surface.
    }
  }

  try {
    const client = createPrivyWalletClient({
      appId: resolvePrivyAppId(env),
      appSecret: env.PRIVY_APP_SECRET,
      // acceptLogin does not call RPC; allow empty and require it only for signing routes.
      rpcUrl: env.QUICKNODE_DEVNET_RPC_URL || null,
      authorizationKey: env.PRIVY_AUTHORIZATION_KEY || null,
      allowUsersMeFallback: !onCloudflareWorker,
    });
    const ownerHeader = request.headers.get('x-owner-id');
    const result = await client.acceptLogin({
      accessToken,
      origin: onCloudflareWorker ? undefined : requestOrigin(request),
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
    let detail = fields?.detail
      || (typeof error?.message === 'string' ? error.message.replace(/[\r\n]+/g, ' ').slice(0, 180) : undefined);
    if (!fields && error?.name === 'TypeError') {
      detail = safeFetchErrorDetail(error);
    }
    const payload = detail ? { error: code, detail } : { error: code };
    console.error('[api/wallets]', payload);
    return Response.json(payload, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
