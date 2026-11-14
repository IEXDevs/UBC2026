/**
 * Enrich the Worker env with Privy signing, Supabase ledger, and commerce hooks
 * when local/deployed secrets are present. Injected doubles always win.
 */
import { createSupabaseLedger } from '@ubc2026/bot-policy/ledger';
import { transferDevnetUsdc } from '@ubc2026/transfers';
import { createPrivyWalletClientFromEnv } from '@ubc2026/wallets/privy';
import { ConfigError } from '@ubc2026/contracts';
import {
  createSupabaseRpc,
  loadOwnerLoopContext,
  supabaseConfig,
} from './supabase-rest.mjs';

function tryPrivyClient(env) {
  if (env.transferClient) return env.transferClient;
  try {
    return createPrivyWalletClientFromEnv(env, { fetcher: env.fetch ?? fetch });
  } catch (error) {
    if (error instanceof ConfigError || error?.code === 'missing_secrets') return null;
    return null;
  }
}

function wrapShoppingSigner(client) {
  if (!client) return null;
  return async ({ amount, payTo, memo, bot, wallet, recentBlockhash } = {}) => {
    if (!bot || !wallet) {
      const error = new Error('bot_and_wallet_required');
      error.code = 'bot_and_wallet_required';
      throw error;
    }
    const sent = await transferDevnetUsdc({
      client,
      bot,
      wallet,
      destination: payTo,
      amount: String(amount),
      memo: memo || 'maelstrom:shop',
      recentBlockhash,
    });
    return sent.signature;
  };
}

function wrapSnsExecutor(client) {
  if (!client) return null;
  return async ({ to, amount, memo, bot, wallet, recentBlockhash } = {}) => {
    if (!bot || !wallet) {
      const error = new Error('bot_and_wallet_required');
      error.code = 'bot_and_wallet_required';
      throw error;
    }
    const sent = await transferDevnetUsdc({
      client,
      bot,
      wallet,
      destination: to,
      amount: String(amount),
      memo: memo || 'maelstrom:sns',
      recentBlockhash,
    });
    return { signature: sent.signature, cluster: 'devnet' };
  };
}

/**
 * Returns a shallow-cloned env with defaults filled in. Original injectables
 * are preserved. Safe to call on every request.
 */
export function enrichEnv(env) {
  if (!env || typeof env !== 'object') return env;
  if (env.__maelstromEnriched) return env;

  const transferClient = env.transferClient ?? tryPrivyClient(env);
  const rpc = typeof env.supabaseRpc === 'function'
    ? env.supabaseRpc
    : createSupabaseRpc(env, env.fetch ?? fetch);
  const ledgerApi = env.ledgerApi
    || (typeof rpc === 'function' ? createSupabaseLedger(rpc) : null);

  const next = {
    ...env,
    __maelstromEnriched: true,
    transferClient,
    ledgerApi,
    supabaseRpc: env.supabaseRpc ?? rpc,
    signShoppingPayment: typeof env.signShoppingPayment === 'function'
      ? env.signShoppingPayment
      : wrapShoppingSigner(transferClient),
    executeSnsTransfer: typeof env.executeSnsTransfer === 'function'
      ? env.executeSnsTransfer
      : wrapSnsExecutor(transferClient),
  };

  if (typeof env.loadLoopContext === 'function') {
    next.loadLoopContext = env.loadLoopContext;
  } else if (supabaseConfig(env)) {
    next.loadLoopContext = async (wake) => loadOwnerLoopContext(next, {
      botId: wake?.botId,
      ownerId: wake?.ownerId || wake?.bot?.ownerId,
    }, next.fetch ?? fetch);
  }

  return next;
}
