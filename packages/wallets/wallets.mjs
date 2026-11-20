/**
 * Privy wallet assignment and freeze helpers.
 * The Privy HTTP path (login provisioning and devnet server signing) lives in
 * `privy.mjs`. Private keys stay in Privy and in environment variables.
 */
import { validateWallet, validateBotRecord, ContractError } from '@ubc2026/contracts';

export class WalletError extends Error {
  constructor(message, code = 'wallet_error') {
    super(message);
    this.name = 'WalletError';
    this.code = code;
  }
}
const fail = message => { throw new WalletError(message); };

export function createMainWallet({ ownerId, address, id = `w_main_${ownerId}` }) {
  return validateWallet({
    id,
    ownerId,
    kind: 'main',
    label: 'Main',
    address,
    frozen: false,
    provider: 'privy',
  });
}

export function createAdditionalWallet({ ownerId, address, label, id }) {
  if (typeof label !== 'string' || !label.trim() || label.length > 64) fail('Additional wallet label is required');
  return validateWallet({
    id: id ?? `w_add_${Date.now().toString(36)}`,
    ownerId,
    kind: 'additional',
    label: label.trim(),
    address,
    frozen: false,
    provider: 'privy',
  });
}

export function assignBotWallet(bot, wallet) {
  validateBotRecord(bot);
  validateWallet(wallet);
  if (wallet.ownerId !== bot.ownerId) fail('Wallet owner must match bot owner');
  if (wallet.frozen) fail('Cannot assign a frozen wallet');
  return { ...bot, walletId: wallet.id };
}

export function listBotsForWallet(bots, walletId) {
  if (!Array.isArray(bots)) fail('Bot list is required');
  return bots.filter(bot => {
    try {
      validateBotRecord(bot);
      return bot.walletId === walletId;
    } catch (error) {
      if (error instanceof ContractError) fail(error.message);
      throw error;
    }
  });
}

export function freezeWallet(wallet) {
  return validateWallet({ ...wallet, frozen: true });
}

export function unfreezeWallet(wallet) {
  return validateWallet({ ...wallet, frozen: false });
}

export function freezeBot(bot) {
  return validateBotRecord({ ...bot, frozen: true, enabled: false });
}

export function assertSpendAllowed({ bot, wallet }) {
  validateBotRecord(bot);
  validateWallet(wallet);
  if (bot.walletId !== wallet.id) fail('Bot is not assigned to this wallet');
  if (bot.frozen || !bot.enabled) fail('Bot is frozen or disabled');
  if (wallet.frozen) fail('Wallet is frozen');
  return { allowed: true };
}

/** Rows for the same owner: agent wallets plus every linked Solana wallet and sign-in method. */
export function accountWriteBodies(login, ownerId) {
  const owner = ownerId || login?.main?.ownerId;
  if (!owner || !login?.main) return null;
  const wallets = [login.main, ...(login.additional || [])].filter(Boolean).map(wallet => ({
    id: wallet.id,
    owner_id: owner,
    kind: wallet.kind,
    label: wallet.label,
    address: wallet.address,
    provider: 'privy',
    spendable: wallet.spendable !== false,
  }));
  return {
    user: {
      id: owner,
      privy_user_id: login.privyUserId || login.main.privyUserId || owner,
      login_methods: Array.isArray(login.loginMethods) ? login.loginMethods : [],
    },
    wallets,
  };
}

// Privy HTTP + node:crypto signing live in `./privy.mjs`.
// Import `@ubc2026/wallets/privy` from Workers/Node only — never from the Next.js client bundle.
