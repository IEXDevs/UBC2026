import { SOLANA_CLUSTER } from '@ubc2026/contracts/solana';
import { parsePrivySigningFailure } from '@ubc2026/contracts';
/**
 * Connected-wallet deposit onto the owner's main wallet.
 * Prepare builds the unsigned mainnet-beta USDC transfer.
 * Broadcast accepts only a signature over that same transfer.
 * Wallet records come from the verified owner, never the request body.
 */
import { Transaction } from '@solana/web3.js';
import { buildSolanaUsdcTransaction } from '@ubc2026/transfers';
import { createPrivyWalletClient } from '@ubc2026/wallets/privy';
import { readRootEnv } from './root-env.mjs';
import { planConnectedDeposit } from './wallet-move.mjs';
import { mergeObservedWallets, resolvePrivyAppId } from './wallet-provision.mjs';
import { verifyPrivyAccessToken } from './privy-access-token.mjs';
import { accessTokenFromRequest } from './privy-cookie-session.mjs';

const ID = /^[a-zA-Z0-9:_.-]{1,256}$/;

function rootEnv() {
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

function clientFrom(secrets) {
  return createPrivyWalletClient({
    appId: resolvePrivyAppId(secrets),
    appSecret: secrets.PRIVY_APP_SECRET,
    rpcUrl: secrets.SOLANA_RPC_URL,
    authorizationKey: secrets.PRIVY_AUTHORIZATION_KEY || null,
  });
}

function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function statusFor(code) {
  if (code === 'missing_config') return 503;
  if (code === 'owner_mismatch') return 403;
  if (code === 'login_required') return 401;
  if (code === 'wallet_move_failed') return 502;
  return 400;
}

function errorBody(code, extra) {
  const privy = parsePrivySigningFailure(extra?.privyFailure);
  return { error: code,
    ...(code === 'missing_config' && Array.isArray(extra?.missing) ? { missing: extra.missing } : {}),
    ...(privy ? { privy } : {}),
  };
}

export function storedWalletRow(row, ownerId) {
  if (!row || typeof row !== 'object' || row.deleted_at) return null;
  if (row.owner_id !== ownerId) return null;
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  const address = typeof row.address === 'string' ? row.address.trim() : '';
  const label = typeof row.label === 'string' ? row.label.trim() : '';
  if (!ID.test(id) || !address || !label || label.length > 64) return null;
  return {
    id,
    ownerId,
    kind: row.kind === 'main' ? 'main' : 'additional',
    label,
    address,
    frozen: row.frozen === true,
    provider: 'privy',
    spendable: row.spendable !== false && !id.startsWith('linked_'),
  };
}

export function walletsForDeposit(stored, user, ownerId) {
  const rows = Array.isArray(stored) ? stored.map(row => storedWalletRow(row, ownerId)).filter(Boolean) : [];
  return mergeObservedWallets(rows, user, ownerId).map(wallet => ({
    ...wallet,
    frozen: wallet.frozen === true,
    provider: 'privy',
  }));
}

function pickWallet(wallets, id, address) {
  const list = Array.isArray(wallets) ? wallets : [];
  if (typeof id === 'string' && ID.test(id.trim())) {
    const byId = list.find(wallet => wallet?.id === id.trim());
    if (byId) return byId;
    if (id.startsWith('linked_')) {
      const linked = list.find(wallet => wallet?.address === id.slice('linked_'.length));
      if (linked) return linked;
    }
  }
  if (typeof address !== 'string' || !address.trim()) return null;
  const byAddress = list.filter(wallet => wallet?.address === address.trim());
  return byAddress.length === 1 ? byAddress[0] : null;
}

export function signedDepositMatches(signedBase64, plan) {
  if (!plan || plan.error || typeof signedBase64 !== 'string') return false;
  let tx;
  try {
    tx = Transaction.from(Buffer.from(signedBase64, 'base64'));
  } catch {
    return false;
  }
  if (!tx.recentBlockhash || !tx.feePayer) return false;
  const signedByFeePayer = Array.isArray(tx.signatures) && tx.signatures.some(entry => (
    entry?.publicKey?.equals?.(tx.feePayer) && entry.signature && entry.signature.length > 0
  ));
  if (!signedByFeePayer) return false;
  let expected;
  try {
    expected = buildSolanaUsdcTransaction({
      feePayer: plan.from.address,
      sourceOwner: plan.from.address,
      destinationOwner: plan.to.address,
      amount: plan.amount,
      memo: plan.memo,
      recentBlockhash: tx.recentBlockhash,
    });
  } catch {
    return false;
  }
  try {
    return tx.serializeMessage().equals(expected.transaction.serializeMessage());
  } catch {
    return false;
  }
}

export async function readStoredWallets(ownerId, secrets, fetcher) {
  const url = typeof secrets.SUPABASE_URL === 'string' ? secrets.SUPABASE_URL.trim() : '';
  const key = typeof secrets.SUPABASE_SERVICE_ROLE_KEY === 'string' ? secrets.SUPABASE_SERVICE_ROLE_KEY.trim() : '';
  if (!url || !key) return [];
  let origin;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return [];
    origin = parsed.origin;
  } catch {
    return [];
  }
  const headers = {
    apikey: key,
    authorization: `Bearer ${key}`,
    accept: 'application/json',
  };
  const filter = `owner_id=eq.${encodeURIComponent(ownerId)}&deleted_at=is.null`;
  let response = await fetcher(
    `${origin}/rest/v1/wallets?${filter}&select=id,owner_id,kind,label,address,provider,frozen,spendable`,
    { method: 'GET', headers, redirect: 'manual' },
  );
  if (!response?.ok) {
    response = await fetcher(
      `${origin}/rest/v1/wallets?${filter}&select=id,owner_id,kind,label,address,provider,frozen`,
      { method: 'GET', headers, redirect: 'manual' },
    );
  }
  if (!response?.ok) return [];
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function defaultLoadWallets(ownerId, accessToken, secrets, fetcher) {
  const client = clientFrom(secrets);
  const user = await client.readLoginUser({ accessToken, ownerId });
  const id = typeof user?.id === 'string' ? user.id.trim() : '';
  if (!id || id !== ownerId) throw fail('owner_mismatch');
  const stored = await readStoredWallets(ownerId, secrets, fetcher);
  return { user, wallets: walletsForDeposit(stored, user, ownerId) };
}

function defaultChain(secrets) {
  const client = clientFrom(secrets);
  return {
    async blockhash() {
      const hash = await client.getSolanaBlockhash();
      if (!hash || hash.cluster !== SOLANA_CLUSTER || typeof hash.blockhash !== 'string') throw fail('wallet_move_failed');
      return hash.blockhash;
    },
    async assertSolana() {
      await client.assertSolanaCluster();
    },
    async broadcast(signedTransaction) {
      const sent = await client.broadcastSignedSolana({ signedTransaction });
      if (!sent || sent.cluster !== SOLANA_CLUSTER || typeof sent.signature !== 'string') throw fail('wallet_move_failed');
      return sent.signature;
    },
  };
}

export async function postConnectedDeposit(request, deps = {}) {
  const accessToken = accessTokenFromRequest(request);
  if (!accessToken) return json({ error: 'login_required' }, 401);
  const secrets = deps.env || rootEnv();
  const appId = resolvePrivyAppId(secrets);
  if (!appId) return json({ error: 'missing_config', missing: ['PRIVY_APP_ID'] }, 503);
  const fetcher = deps.fetcher || globalThis.fetch.bind(globalThis);
  let ownerId;
  try {
    const verified = await verifyPrivyAccessToken(accessToken, {
      appId,
      fetcher: deps.jwksFetcher || fetcher,
      now: deps.now,
    });
    ownerId = verified.sub;
  } catch (error) {
    const code = error?.code === 'missing_config' ? 'missing_config' : 'login_required';
    return json(errorBody(code, error), statusFor(code));
  }
  const body = await request.json().catch(() => ({}));
  const amount = typeof body?.amount === 'string' ? body.amount : '';
  let loaded;
  try {
    const load = deps.loadWallets || (id => defaultLoadWallets(id, accessToken, secrets, fetcher));
    loaded = await load(ownerId, accessToken);
  } catch (error) {
    const code = typeof error?.code === 'string' && /^[a-z0-9_]{1,64}$/.test(error.code)
      ? error.code
      : 'wallet_move_failed';
    return json(errorBody(code, error), statusFor(code));
  }
  const wallets = Array.isArray(loaded?.wallets) ? loaded.wallets : (Array.isArray(loaded) ? loaded : []);
  const plan = planConnectedDeposit({
    from: pickWallet(wallets, body?.fromId, body?.fromAddress),
    to: pickWallet(wallets, body?.toId, body?.toAddress),
    amount,
    ownerId,
    env: secrets,
  });
  if (plan.error) return json(errorBody(plan.error, plan), statusFor(plan.error));
  const chain = deps.chain || defaultChain(secrets);
  try {
    if (body?.phase === 'broadcast') {
      const signed = typeof body.signedTransaction === 'string' ? body.signedTransaction.trim() : '';
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signed) || signed.length < 80 || signed.length > 12000) {
        return json({ error: 'invalid_signature' }, 400);
      }
      if (!signedDepositMatches(signed, plan)) return json({ error: 'transaction_mismatch' }, 400);
      await chain.assertSolana();
      const signature = await chain.broadcast(signed);
      return json({ ok: true, signature, cluster: SOLANA_CLUSTER });
    }
    const blockhash = await chain.blockhash();
    const built = buildSolanaUsdcTransaction({
      feePayer: plan.from.address,
      sourceOwner: plan.from.address,
      destinationOwner: plan.to.address,
      amount: plan.amount,
      memo: plan.memo,
      recentBlockhash: blockhash,
    });
    return json({ ok: true, transaction: built.transactionBase64, cluster: SOLANA_CLUSTER });
  } catch (error) {
    const code = typeof error?.code === 'string' && /^[a-z0-9_]{1,64}$/.test(error.code)
      ? error.code
      : 'wallet_move_failed';
    return json(errorBody(code, error), statusFor(code));
  }
}
