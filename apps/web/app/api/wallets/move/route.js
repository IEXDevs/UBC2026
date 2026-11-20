import { SOLANA_CLUSTER } from '@ubc2026/contracts/solana';
import { parsePrivySigningFailure } from '@ubc2026/contracts';
export const runtime = 'nodejs';

import { moveBetweenWallets } from '@ubc2026/transfers';
import { createPrivyWalletClient } from '@ubc2026/wallets/privy';
import { readStoredWallets, storedWalletRow, walletsForDeposit } from '../../../../lib/connected-deposit.mjs';
import { accessTokenFromRequest } from '../../../../lib/privy-cookie-session.mjs';
import { verifyPrivyAccessToken } from '../../../../lib/privy-access-token.mjs';
import { readRootEnv } from '../../../../lib/root-env.mjs';
import { planWalletMove, selectOwnedMoveRecipient, selectOwnedMoveWallet } from '../../../../lib/wallet-move.mjs';
import { resolvePrivyAppId } from '../../../../lib/wallet-provision.mjs';
import { sendWalletAsset } from '../../../../lib/wallet-asset-send.mjs';

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

export async function POST(request) {
  const accessToken = accessTokenFromRequest(request);
  if (!accessToken) {
    return Response.json({ error: 'login_required' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  const secrets = env();
  const appId = resolvePrivyAppId(secrets);
  const missing = ['PRIVY_APP_SECRET', 'SOLANA_RPC_URL'].filter(name => !secrets[name]);
  if (!appId) missing.unshift('PRIVY_APP_ID');
  if (missing.length) {
    return Response.json({ error: 'missing_config', missing }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
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
  try {
    const client = createPrivyWalletClient({
      appId,
      appSecret: secrets.PRIVY_APP_SECRET,
      rpcUrl: secrets.SOLANA_RPC_URL,
      authorizationKey: secrets.PRIVY_AUTHORIZATION_KEY || null,
    });
    const rows = await readStoredWallets(ownerId, secrets, fetch);
    const wallets = rows.map(row => storedWalletRow(row, ownerId)).filter(Boolean);
    if (body.asset !== undefined) {
      const user = await client.readLoginUser({ accessToken, ownerId });
      if (user?.id !== ownerId) return Response.json({ error: 'owner_mismatch' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
      const verified = walletsForDeposit(rows, user, ownerId);
      const signable = verified.filter(wallet => wallet?.spendable
        && !String(wallet.id).startsWith('client_')
        && !String(wallet.id).startsWith('linked_'));
      const observed = selectOwnedMoveRecipient(verified.filter(wallet => wallet.spendable === false), body?.from);
      const from = selectOwnedMoveWallet(signable, body?.from) || observed;
      const sent = await sendWalletAsset({ client, ownerId, from, wallets: verified, destination: body.destination, asset: body.asset, amount: body.amount, decimals: body.decimals, phase: body.phase, signedTransaction: body.signedTransaction, accessToken });
      return Response.json(sent, { headers: { 'Cache-Control': 'no-store' } });
    }
    let recipient = selectOwnedMoveRecipient(wallets, body?.to);
    if (!recipient) {
      const user = await client.readLoginUser({ accessToken, ownerId });
      if (user?.id !== ownerId) {
        return Response.json({ error: 'owner_mismatch' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
      }
      recipient = selectOwnedMoveRecipient(walletsForDeposit(rows, user, ownerId), body?.to);
    }
    const plan = planWalletMove({
      from: selectOwnedMoveWallet(wallets, body?.from),
      to: recipient,
      amount: body?.amount,
      ownerId,
      env: secrets,
    });
    if (plan.error) {
      const status = plan.error === 'missing_config' ? 503 : plan.error === 'owner_mismatch' ? 403 : 400;
      return Response.json(
        plan.error === 'missing_config' ? { error: plan.error, missing: plan.missing } : { error: plan.error },
        { status, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const main = plan.from.kind !== 'main'
      ? wallets.find(wallet => wallet.kind === 'main' && wallet.ownerId === ownerId && wallet.spendable && !wallet.frozen
        && !String(wallet.id).startsWith('linked_') && !String(wallet.id).startsWith('client_'))
      : null;
    const feePayerWallet = main ? selectOwnedMoveWallet(wallets, main) : undefined;
    const sent = await moveBetweenWallets({
      client,
      ownerId,
      accessToken,
      fromWallet: plan.from,
      feePayerWallet,
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
    console.error('wallet_move_failed', { code, privy: parsePrivySigningFailure(error?.privyFailure) });
    const privy = parsePrivySigningFailure(error?.privyFailure);
    return Response.json({ error: code, ...(privy ? { privy } : {}) }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
