export const runtime = 'nodejs';

import { createPrivyWalletClient } from '@ubc2026/wallets/privy';
import { accessTokenFromRequest } from '../../../../lib/privy-cookie-session.mjs';
import { verifyPrivyAccessToken } from '../../../../lib/privy-access-token.mjs';
import { readRootEnv } from '../../../../lib/root-env.mjs';
import { missingWalletSecrets, resolvePrivyAppId } from '../../../../lib/wallet-provision.mjs';
import { publicWallet, walletErrorFields, walletErrorStatus } from '../../../../lib/wallets-route.mjs';

const LABEL = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;
const IDEMPOTENCY = /^[A-Za-z0-9_-]{8,80}$/;

function env() {
  return {
    PRIVY_APP_ID: readRootEnv('PRIVY_APP_ID'),
    PRIVY_APP_SECRET: readRootEnv('PRIVY_APP_SECRET'),
    SOLANA_RPC_URL: readRootEnv('SOLANA_RPC_URL'),
    PRIVY_AUTHORIZATION_KEY: readRootEnv('PRIVY_AUTHORIZATION_KEY'),
    NEXT_PUBLIC_PRIVY_APP_ID: readRootEnv('NEXT_PUBLIC_PRIVY_APP_ID'),
    SUPABASE_URL: readRootEnv('SUPABASE_URL'),
    SUPABASE_SERVICE_ROLE_KEY: readRootEnv('SUPABASE_SERVICE_ROLE_KEY'),
  };
}

async function persistWallet(wallet, ownerId, secrets) {
  const url = secrets.SUPABASE_URL;
  const key = secrets.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !wallet) return;
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
  const row = {
    id: wallet.id,
    owner_id: ownerId,
    kind: wallet.kind === 'main' ? 'main' : 'additional',
    label: wallet.label,
    address: wallet.address,
    provider: 'privy',
    spendable: true,
  };
  const response = await fetch(`${origin}/rest/v1/wallets`, {
    method: 'POST',
    headers,
    body: JSON.stringify(row),
    redirect: 'manual',
  });
  if (response.ok) return;
  const core = { ...row };
  delete core.spendable;
  await fetch(`${origin}/rest/v1/wallets`, {
    method: 'POST',
    headers,
    body: JSON.stringify(core),
    redirect: 'manual',
  });
}

export async function POST(request) {
  const accessToken = accessTokenFromRequest(request);
  if (!accessToken) {
    return Response.json({ error: 'login_required' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  const secrets = env();
  const missing = missingWalletSecrets(secrets);
  if (missing.length) {
    return Response.json({ error: 'missing_config', missing }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  const appId = resolvePrivyAppId(secrets);
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
  const body = await request.json().catch(() => ({}));
  const label = typeof body.label === 'string' && LABEL.test(body.label.trim()) ? body.label.trim() : '';
  if (!label) {
    return Response.json({ error: 'invalid_wallet' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const idempotencyKey = typeof body.idempotencyKey === 'string' && IDEMPOTENCY.test(body.idempotencyKey)
    ? body.idempotencyKey
    : undefined;
  try {
    const client = createPrivyWalletClient({
      appId,
      appSecret: secrets.PRIVY_APP_SECRET,
      rpcUrl: secrets.SOLANA_RPC_URL || null,
      authorizationKey: secrets.PRIVY_AUTHORIZATION_KEY || null,
      signerId: readRootEnv('NEXT_PUBLIC_PRIVY_SIGNER_ID') || null,
    });
    const created = await client.createAdditional({
      privyUserId: ownerId,
      ownerId,
      label,
      idempotencyKey,
    });
    try {
      await persistWallet(created, ownerId, secrets);
    } catch {
      console.error('[api/wallets/additional]', 'account_persist_failed');
    }
    return Response.json({ ok: true, wallet: publicWallet(created) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const fields = walletErrorFields(error);
    const code = fields?.code || 'wallet_failed';
    const status = code === 'main_wallet_required' || code === 'invalid_wallet' ? 400 : walletErrorStatus(code);
    const detail = fields?.detail;
    return Response.json(detail ? { error: code, detail } : { error: code }, {
      status,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
