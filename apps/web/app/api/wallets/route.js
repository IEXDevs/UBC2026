export const runtime = 'nodejs';

import { accountWriteBodies } from '@ubc2026/wallets';
import { createPrivyWalletClient } from '@ubc2026/wallets/privy';
import { accessTokenFromRequest } from '../../../lib/privy-cookie-session.mjs';
import { verifyPrivyAccessToken } from '../../../lib/privy-access-token.mjs';
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
  filterArchivedWallets,
  needsArchivedReissue,
  publicWallet,
  requestOrigin,
  walletErrorFields,
  walletErrorStatus,
} from '../../../lib/wallets-route.mjs';

function supabaseOrigin() {
  const url = readRootEnv('SUPABASE_URL');
  const key = readRootEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    return { origin: parsed.origin, key };
  } catch {
    return null;
  }
}

/** Ids the owner soft-deleted. Login must not resurrect them on a new device. */
async function readDeletedWalletIds(ownerId) {
  const db = supabaseOrigin();
  if (!db) return new Set();
  try {
    const response = await fetch(
      `${db.origin}/rest/v1/wallets?owner_id=eq.${encodeURIComponent(ownerId)}&select=id&deleted_at=not.is.null`,
      {
        headers: { apikey: db.key, authorization: `Bearer ${db.key}`, accept: 'application/json' },
        redirect: 'manual',
      },
    );
    const rows = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(rows)) return new Set();
    return new Set(rows.map(row => row?.id).filter(id => typeof id === 'string'));
  } catch {
    return new Set();
  }
}

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
    SOLANA_RPC_URL: readRootEnv('SOLANA_RPC_URL'),
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

  const appId = resolvePrivyAppId(env);
  let ownerId;
  try {
    ({ sub: ownerId } = await verifyPrivyAccessToken(accessToken, { appId }));
  } catch {
    return Response.json({ error: 'login_required' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  const ownerHeader = request.headers.get('x-owner-id');
  if (ownerHeader !== null && ownerHeader !== ownerId) {
    return Response.json({ error: 'owner_mismatch' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const client = createPrivyWalletClient({
      appId,
      appSecret: env.PRIVY_APP_SECRET,
      // acceptLogin does not call RPC; allow empty and require it only for signing routes.
      rpcUrl: env.SOLANA_RPC_URL || null,
      authorizationKey: env.PRIVY_AUTHORIZATION_KEY || null,
      signerId: readRootEnv('NEXT_PUBLIC_PRIVY_SIGNER_ID') || readRootEnv('PRIVY_SIGNER_ID') || null,
      allowUsersMeFallback: !onCloudflareWorker,
    });
    const result = await client.acceptLogin({
      accessToken,
      origin: onCloudflareWorker ? undefined : requestOrigin(request),
      ownerId,
    });
    try {
      await persistAccount(result, ownerId);
    } catch {
      console.error('[api/wallets]', 'account_persist_failed');
    }
    const deletedIds = await readDeletedWalletIds(ownerId);
    let wallets = filterArchivedWallets([result.main, ...result.additional], deletedIds);
    let created = result.created === true;
    if (needsArchivedReissue(wallets, deletedIds)) {
      // The owner archived everything. Privy still holds the old wallets, so
      // acceptLogin reports created:false and no usable wallet exists. Issue
      // a fresh wallet so agents have assets to access.
      try {
        const fresh = await client.createAdditional({
          privyUserId: ownerId,
          ownerId,
          label: `Additional ${(result.additional || []).length + 1}`,
          accessToken,
        });
        try {
          await persistAccount(
            { ...result, additional: [...(result.additional || []), fresh] },
            ownerId,
          );
        } catch {
          console.error('[api/wallets]', 'account_persist_failed');
        }
        const pub = publicWallet(fresh);
        if (pub) {
          wallets = [pub];
          created = true;
        }
      } catch (error) {
        console.error('[api/wallets]', 'archived_reissue_failed');
      }
    }
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
              'x-owner-id': ownerId,
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
      created,
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
