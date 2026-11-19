export const runtime = 'nodejs';

import { resolveSnsOwner, SnsError } from '@ubc2026/sns';
import { withdrawToWalletAdapter } from '@ubc2026/transfers';
import { createPrivyWalletClient } from '@ubc2026/wallets/privy';
import { accessTokenFromRequest } from '../../../../lib/privy-cookie-session.mjs';
import { readRootEnv } from '../../../../lib/root-env.mjs';
import { planSnsSend } from '../../../../lib/sns-send.mjs';
import { resolvePrivyAppId } from '../../../../lib/wallet-provision.mjs';

function env() {
  return {
    PRIVY_APP_ID: readRootEnv('PRIVY_APP_ID'),
    PRIVY_APP_SECRET: readRootEnv('PRIVY_APP_SECRET'),
    QUICKNODE_DEVNET_RPC_URL: readRootEnv('QUICKNODE_DEVNET_RPC_URL'),
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
  let resolved;
  try {
    resolved = await resolveSnsOwner(body.domain);
  } catch (error) {
    const code = error instanceof SnsError ? 'sns_not_found' : 'sns_failed';
    return Response.json({ error: code }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  const plan = planSnsSend({
    domain: resolved.domain,
    address: resolved.address,
    amount: body.amount,
    wallet: body.wallet,
    env: env(),
  });
  if (plan.error) {
    const status = plan.error === 'missing_config' ? 503 : 400;
    return Response.json(plan, { status, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!ownerId || plan.wallet.ownerId !== ownerId) {
    return Response.json({ error: 'owner_mismatch', domain: plan.domain, address: plan.address }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const secrets = env();
    const client = createPrivyWalletClient({
      appId: resolvePrivyAppId(secrets),
      appSecret: secrets.PRIVY_APP_SECRET,
      rpcUrl: secrets.QUICKNODE_DEVNET_RPC_URL,
      authorizationKey: secrets.PRIVY_AUTHORIZATION_KEY || null,
    });
    const sent = await withdrawToWalletAdapter({
      client,
      ownerId,
      mainWallet: plan.wallet,
      adapter: { publicKey: plan.address },
      amount: plan.amount,
      memo: plan.memo,
    });
    return Response.json({
      ok: true,
      domain: plan.domain,
      address: plan.address,
      signature: sent.signature,
      cluster: 'devnet',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const code = typeof error?.code === 'string' ? error.code : 'sns_send_failed';
    return Response.json({
      error: code,
      domain: plan.domain,
      address: plan.address,
    }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
