import { SOLANA_CLUSTER } from '@ubc2026/contracts/solana';
import { parsePrivySigningFailure } from '@ubc2026/contracts';
export const runtime = 'nodejs';

import { resolveSnsOwner, SnsError } from '@ubc2026/sns';
import { withdrawToWalletAdapter } from '@ubc2026/transfers';
import { createPrivyWalletClient } from '@ubc2026/wallets/privy';
import { accessTokenFromRequest } from '../../../../lib/privy-cookie-session.mjs';
import { verifyPrivyAccessToken } from '../../../../lib/privy-access-token.mjs';
import { readRootEnv } from '../../../../lib/root-env.mjs';
import { planSnsSend } from '../../../../lib/sns-send.mjs';
import { resolvePrivyAppId } from '../../../../lib/wallet-provision.mjs';

function env() {
  return {
    PRIVY_APP_ID: readRootEnv('PRIVY_APP_ID'),
    PRIVY_APP_SECRET: readRootEnv('PRIVY_APP_SECRET'),
    SOLANA_RPC_URL: readRootEnv('SOLANA_RPC_URL'),
    PRIVY_AUTHORIZATION_KEY: readRootEnv('PRIVY_AUTHORIZATION_KEY'),
    NEXT_PUBLIC_PRIVY_APP_ID: readRootEnv('NEXT_PUBLIC_PRIVY_APP_ID'),
  };
}

export async function POST(request) {
  const accessToken = accessTokenFromRequest(request);
  if (!accessToken) {
    return Response.json({ error: 'login_required' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  const secrets = env();
  const appId = resolvePrivyAppId(secrets);
  let ownerId;
  try {
    ({ sub: ownerId } = await verifyPrivyAccessToken(accessToken, { appId }));
  } catch (error) {
    const privy = parsePrivySigningFailure(error?.privyFailure);
    return Response.json({ error: 'login_required', ...(privy ? { privy } : {}) }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  const ownerHeader = request.headers.get('x-owner-id');
  if (ownerHeader !== null && ownerHeader !== ownerId) {
    return Response.json({ error: 'owner_mismatch' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  const body = await request.json().catch(() => ({}));
  let resolved;
  try {
    resolved = await resolveSnsOwner(body.domain);
  } catch (error) {
    const code = error instanceof SnsError ? 'sns_not_found' : 'sns_failed';
    const privy = parsePrivySigningFailure(error?.privyFailure);
    return Response.json({ error: code, ...(privy ? { privy } : {}) }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  const plan = planSnsSend({
    domain: resolved.domain,
    address: resolved.address,
    amount: body.amount,
    wallet: body.wallet,
    env: secrets,
  });
  if (plan.error) {
    const status = plan.error === 'missing_config' ? 503 : 400;
    return Response.json(plan, { status, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!ownerId || plan.wallet.ownerId !== ownerId) {
    return Response.json({ error: 'owner_mismatch', domain: plan.domain, address: plan.address }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const client = createPrivyWalletClient({
      appId,
      appSecret: secrets.PRIVY_APP_SECRET,
      rpcUrl: secrets.SOLANA_RPC_URL,
      authorizationKey: secrets.PRIVY_AUTHORIZATION_KEY || null,
    });
    const { main } = await client.ensureMainWallet({ privyUserId: ownerId, ownerId });
    if (!main || main.id !== plan.wallet.id || main.address !== plan.wallet.address) {
      return Response.json({ error: 'wallet_not_owned' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
    }
    const sent = await withdrawToWalletAdapter({
      client,
      ownerId,
      mainWallet: main,
      adapter: { publicKey: plan.address },
      amount: plan.amount,
      memo: plan.memo,
    });
    return Response.json({
      ok: true,
      domain: plan.domain,
      address: plan.address,
      signature: sent.signature,
      cluster: SOLANA_CLUSTER,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const code = typeof error?.code === 'string' && /^[a-z0-9_]{1,64}$/.test(error.code) ? error.code : 'sns_send_failed';
    const privy = parsePrivySigningFailure(error?.privyFailure);
    return Response.json({
      error: code,
      ...(privy ? { privy } : {}),
      domain: plan.domain,
      address: plan.address,
    }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
