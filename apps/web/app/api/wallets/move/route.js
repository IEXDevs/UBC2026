import { SOLANA_CLUSTER } from '@ubc2026/contracts/solana';
export const runtime = 'nodejs';

import { moveBetweenWallets } from '@ubc2026/transfers';
import { createPrivyWalletClient } from '@ubc2026/wallets/privy';
import { accessTokenFromRequest } from '../../../../lib/privy-cookie-session.mjs';
import { readRootEnv } from '../../../../lib/root-env.mjs';
import { planWalletMove } from '../../../../lib/wallet-move.mjs';
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
  const body = await request.json().catch(() => ({}));
  const ownerHeader = request.headers.get('x-owner-id');
  const ownerId = typeof ownerHeader === 'string' ? ownerHeader.trim() : '';
  const plan = planWalletMove({
    from: body.from,
    to: body.to,
    amount: body.amount,
    ownerId,
    env: env(),
  });
  if (plan.error) {
    const status = plan.error === 'missing_config' ? 503 : plan.error === 'owner_mismatch' ? 403 : 400;
    return Response.json(
      plan.error === 'missing_config' ? { error: plan.error, missing: plan.missing } : { error: plan.error },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  try {
    const secrets = env();
    const client = createPrivyWalletClient({
      appId: resolvePrivyAppId(secrets),
      appSecret: secrets.PRIVY_APP_SECRET,
      rpcUrl: secrets.SOLANA_RPC_URL,
      authorizationKey: secrets.PRIVY_AUTHORIZATION_KEY || null,
    });
    const sent = await moveBetweenWallets({
      client,
      ownerId,
      fromWallet: plan.from,
      toWallet: plan.to,
      amount: plan.amount,
      memo: plan.memo,
    });
    return Response.json({
      ok: true,
      address: plan.to.address,
      signature: sent.signature,
      cluster: SOLANA_CLUSTER,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const code = typeof error?.code === 'string' && /^[a-z0-9_]{1,64}$/.test(error.code)
      ? error.code
      : 'wallet_move_failed';
    return Response.json({ error: code }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
