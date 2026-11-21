/**
 * Privy signers let the server sign for user-owned wallets while the owner
 * is away. The signer is the key quorum of PRIVY_AUTHORIZATION_KEY; its id
 * is public. Without it on a wallet, app-key signing returns 401.
 */
const SIGNER_ID = /^[A-Za-z0-9_-]{8,128}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function serverSignerFailure(error) {
  const status = Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599 ? error.status : undefined;
  const code = typeof error?.code === 'string' && /^[a-zA-Z0-9_.-]{1,64}$/.test(error.code) ? error.code : 'unknown';
  const detail = [error?.error, error?.message].filter(value => typeof value === 'string').join(' ').slice(0, 2048);
  const reasons = [
    [/on.device execution|TEE execution/i, 'This Privy wallet uses on-device execution and cannot add this server signer.'],
    [/mfa|multi.factor/i, 'Privy requires multi-factor authentication.'],
    [/expired|session|login|log.in/i, 'Privy requires a fresh authenticated session.'],
    [/not.found|does.not.exist|unknown.signer|invalid.{0,20}(signer|quorum)/i, 'Privy could not find the signer or key quorum for this app.'],
    [/unauthori[sz]ed|forbidden|permission|not.allowed|not.owner/i, 'Privy denied permission to add this signer.'],
    [/not.supported|unsupported|not.enabled/i, 'Privy does not support or enable this signer operation for this wallet.'],
    [/already/i, 'Privy reports the signer is already configured.'],
    [/invalid|malformed/i, 'Privy rejected the signer configuration.'],
    [/network|fetch|timeout/i, 'The Privy signer request could not complete.'],
  ];
  const message = reasons.find(([pattern]) => pattern.test(detail))?.[1] || 'Privy rejected adding the server signer.';
  return { ...(status ? { status } : {}), code, message };
}

export function privySignerId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  return SIGNER_ID.test(id) ? id : '';
}

function linkedAccounts(user) {
  if (Array.isArray(user?.linkedAccounts)) return user.linkedAccounts;
  if (Array.isArray(user?.linked_accounts)) return user.linked_accounts;
  return [];
}

/** Addresses of the owner's Privy Solana wallets that the server cannot sign for yet. */
export function walletsNeedingSigner(user, signerId) {
  if (!privySignerId(signerId)) return [];
  const addresses = [];
  for (const account of linkedAccounts(user)) {
    if (account?.type !== 'wallet') continue;
    const client = account.walletClientType ?? account.wallet_client_type;
    const chain = account.chainType ?? account.chain_type;
    if (client !== 'privy' || chain !== 'solana') continue;
    if (account.delegated === true) continue;
    if (typeof account.address !== 'string' || !BASE58.test(account.address)) continue;
    if (!addresses.includes(account.address)) addresses.push(account.address);
  }
  return addresses;
}
