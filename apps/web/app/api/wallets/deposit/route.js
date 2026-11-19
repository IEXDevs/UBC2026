export const runtime = 'nodejs';

import { buildDevnetUsdcTransaction } from '@ubc2026/transfers';
import { createPrivyWalletClient } from '@ubc2026/wallets/privy';
import { readRootEnv } from '../../../../lib/root-env.mjs';
import { planConnectedDeposit } from '../../../../lib/wallet-move.mjs';
import { resolvePrivyAppId } from '../../../../lib/wallet-provision.mjs';

const SIGNED = /^[A-Za-z0-9+/]+={0,2}$/;

function env() {
  return {
    PRIVY_APP_ID: readRootEnv('PRIVY_APP_ID'),
    PRIVY_APP_SECRET: readRootEnv('PRIVY_APP_SECRET'),
    QUICKNODE_DEVNET_RPC_URL: readRootEnv('QUICKNODE_DEVNET_RPC_URL'),
    PRIVY_AUTHORIZATION_KEY: readRootEnv('PRIVY_AUTHORIZATION_KEY'),
    NEXT_PUBLIC_PRIVY_APP_ID: readRootEnv('NEXT_PUBLIC_PRIVY_APP_ID'),
  };
}

function clientFrom(secrets) {
  return createPrivyWalletClient({
    appId: resolvePrivyAppId(secrets),
    appSecret: secrets.PRIVY_APP_SECRET,
    rpcUrl: secrets.QUICKNODE_DEVNET_RPC_URL,
    authorizationKey: secrets.PRIVY_AUTHORIZATION_KEY || null,
  });
}

function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request) {
  const header = request.headers.get('authorization') ?? '';
  const accessToken = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!accessToken) return json({ error: 'login_required' }, 401);
  const body = await request.json().catch(() => ({}));
  const ownerHeader = request.headers.get('x-owner-id');
  const ownerId = typeof ownerHeader === 'string' ? ownerHeader.trim() : '';
  const secrets = env();
  try {
    if (body.phase === 'broadcast') {
      const signed = typeof body.signedTransaction === 'string' ? body.signedTransaction.trim() : '';
      if (!SIGNED.test(signed) || signed.length < 80 || signed.length > 12000) {
        return json({ error: 'invalid_signature' }, 400);
      }
      const client = clientFrom(secrets);
      await client.assertDevnetCluster();
      const sent = await client.broadcastSignedDevnet({ signedTransaction: signed });
      if (!sent || sent.cluster !== 'devnet' || typeof sent.signature !== 'string') {
        return json({ error: 'wallet_move_failed' }, 502);
      }
      return json({ ok: true, signature: sent.signature, cluster: 'devnet' });
    }
    const plan = planConnectedDeposit({
      from: body.from,
      to: body.to,
      amount: body.amount,
      ownerId,
      env: secrets,
    });
    if (plan.error) {
      const status = plan.error === 'missing_config' ? 503 : plan.error === 'owner_mismatch' ? 403 : 400;
      return json(
        plan.error === 'missing_config' ? { error: plan.error, missing: plan.missing } : { error: plan.error },
        status,
      );
    }
    const client = clientFrom(secrets);
    const hash = await client.getDevnetBlockhash();
    const built = buildDevnetUsdcTransaction({
      feePayer: plan.from.address,
      sourceOwner: plan.from.address,
      destinationOwner: plan.to.address,
      amount: plan.amount,
      memo: plan.memo,
      recentBlockhash: hash.blockhash,
    });
    return json({
      ok: true,
      transaction: built.transactionBase64,
      cluster: 'devnet',
    });
  } catch (error) {
    const code = typeof error?.code === 'string' && /^[a-z0-9_]{1,64}$/.test(error.code)
      ? error.code
      : 'wallet_move_failed';
    return json({ error: code }, 502);
  }
}
