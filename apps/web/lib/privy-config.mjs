/**
 * Privy login settings for the glass shell.
 * App id and client id are public. Never put PRIVY_APP_SECRET or an RPC URL here.
 * Dashboard login methods: Email, Google, GitHub, Discord, and Solana wallets.
 * Ethereum wallet login and Ethereum embedded wallets stay off.
 * Signup creates a Solana embedded wallet for every user.
 * Dashboard MFA (authenticator app and passkey) stays enabled; prompts use Privy's UI.
 *
 * Sessions go to auth.privy.io (never a same-origin /api/privy-auth proxy).
 * Cookie write is off so HttpOnly cookie mode cannot rewrite that API base.
 * Client captcha is off so wallet connect does not depend on Turnstile.
 */

export const PRIVY_AUTH_API_URL = 'https://auth.privy.io';

const SOLANA_WALLETS = Object.freeze([
  'phantom',
  'solflare',
  'backpack',
  'jupiter',
  'detected_solana_wallets',
  'wallet_connect_qr_solana',
]);

const SOLANA_LOGIN = Object.freeze({
  appearance: Object.freeze({
    theme: 'dark',
    accentColor: '#3dd6c6',
    walletChainType: 'solana-only',
    walletList: SOLANA_WALLETS,
  }),
  loginMethods: Object.freeze(['email', 'google', 'github', 'discord', 'wallet']),
  // Wallet create-on-login logs the user out on failure. The shell provisions
  // Solana wallets via POST /api/wallets after a stable session instead.
  embeddedWallets: Object.freeze({
    ethereum: Object.freeze({ createOnLogin: 'off' }),
    solana: Object.freeze({ createOnLogin: 'off' }),
  }),
  mfa: Object.freeze({ noPromptOnMfaRequired: false }),
  captchaEnabled: false,
  sessions: Object.freeze({
    cookieWriteBehavior: 'never',
  }),
});

function publicId(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes(' ') || trimmed.length > 128) return '';
  return trimmed;
}

function textField(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function linkedAccountLabel(user) {
  const accounts = Array.isArray(user?.linkedAccounts)
    ? user.linkedAccounts
    : (Array.isArray(user?.linked_accounts) ? user.linked_accounts : []);
  for (const account of accounts) {
    if (!account || typeof account !== 'object') continue;
    const type = typeof account.type === 'string' ? account.type : '';
    if (type === 'google_oauth' || type === 'google') {
      const label = textField(account.email, account.name);
      if (label) return label;
    }
    if (type === 'github_oauth' || type === 'github') {
      const label = textField(account.username, account.name, account.email);
      if (label) return label.startsWith('@') ? label : `@${label}`;
    }
    if (type === 'discord_oauth' || type === 'discord') {
      const label = textField(account.username, account.email);
      if (label) return label;
    }
  }
  return '';
}

export function privyProviderProps({ appId, clientId } = {}) {
  const id = publicId(appId);
  if (!id) return null;
  const props = {
    appId: id,
    apiUrl: PRIVY_AUTH_API_URL,
    config: {
      appearance: {
        ...SOLANA_LOGIN.appearance,
        walletList: [...SOLANA_LOGIN.appearance.walletList],
      },
      loginMethods: [...SOLANA_LOGIN.loginMethods],
      embeddedWallets: {
        ethereum: { ...SOLANA_LOGIN.embeddedWallets.ethereum },
        solana: { ...SOLANA_LOGIN.embeddedWallets.solana },
      },
      mfa: { ...SOLANA_LOGIN.mfa },
      captchaEnabled: SOLANA_LOGIN.captchaEnabled,
      sessions: { ...SOLANA_LOGIN.sessions },
    },
  };
  const client = publicId(clientId);
  if (client) props.clientId = client;
  return props;
}

/** Empty arrays wipe Privy's built-in adapters ("No available adapters"). */
export function usableSolanaConnectors(value) {
  if (Array.isArray(value)) return value.length > 0 ? value : null;
  if (value && typeof value === 'object') return value;
  return null;
}

export function readSolanaConnectors(load) {
  if (typeof load !== 'function') return null;
  try {
    return usableSolanaConnectors(load());
  } catch {
    return null;
  }
}

export function withSolanaExternalWallets(config, connectors) {
  const base = config && typeof config === 'object' ? { ...config } : {};
  const usable = usableSolanaConnectors(connectors);
  if (!usable) return base;
  return {
    ...base,
    externalWallets: { solana: { connectors: usable } },
  };
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const ACCOUNT_METHODS = Object.freeze([
  Object.freeze({ id: 'email', label: 'Email', types: Object.freeze(['email']) }),
  Object.freeze({ id: 'google', label: 'Google', types: Object.freeze(['google_oauth', 'google']) }),
  Object.freeze({ id: 'github', label: 'GitHub', types: Object.freeze(['github_oauth', 'github']) }),
  Object.freeze({ id: 'discord', label: 'Discord', types: Object.freeze(['discord_oauth', 'discord']) }),
]);

function linkedAccountList(user) {
  if (Array.isArray(user?.linkedAccounts)) return user.linkedAccounts;
  if (Array.isArray(user?.linked_accounts)) return user.linked_accounts;
  return [];
}

function accountDetail(account) {
  return textField(
    account.email,
    account.address && account.type !== 'wallet' ? account.address : '',
    account.username,
    account.name,
    account.subject,
  );
}

/**
 * One Privy user is the account. Wallets can be added without a cap.
 * Email and each social login can be linked once. Signing in with any
 * linked method returns this same user id.
 */
export function describeLoginMethods(user) {
  const accounts = linkedAccountList(user);
  const wallets = [];
  const seen = new Set();
  const linked = new Map();
  for (const account of accounts) {
    if (!account || typeof account !== 'object') continue;
    const type = typeof account.type === 'string' ? account.type : '';
    if (!linked.has(type)) linked.set(type, accountDetail(account));
    if (type !== 'wallet') continue;
    const chain = account.chainType ?? account.chain_type;
    const address = typeof account.address === 'string' ? account.address.trim() : '';
    if ((chain && chain !== 'solana') || !BASE58.test(address) || seen.has(address)) continue;
    seen.add(address);
    const client = account.walletClientType ?? account.wallet_client_type ?? 'wallet';
    wallets.push({
      address,
      client: typeof client === 'string' ? client : 'wallet',
      spendable: client === 'privy',
    });
  }
  return {
    userId: typeof user?.id === 'string' ? user.id : '',
    wallets,
    methods: ACCOUNT_METHODS.map(method => {
      const match = method.types.find(type => linked.has(type));
      return {
        id: method.id,
        label: method.label,
        linked: Boolean(match),
        detail: match ? linked.get(match) : '',
      };
    }),
  };
}

export function ownerIdFromPrivyUser(user, authenticated) {
  if (authenticated !== true || !user || typeof user.id !== 'string') return null;
  const id = user.id.trim();
  if (!id || id.length > 256) return null;
  return id;
}

/**
 * Wallet provisioning calls getAccessToken() once Privy reports a signed-in
 * user. Require-terms is off in the dashboard, so we no longer gate on
 * hasAcceptedTerms (that blocked provision and fought refresh).
 */
export function sessionReadyForWallets(signedIn, user) {
  return signedIn === true && Boolean(user);
}

export function privyAccountLabel(user) {
  const email = user?.email?.address;
  if (typeof email === 'string' && email.trim()) return email.trim();

  const google = textField(user?.google?.email, user?.google?.name);
  if (google) return google;

  const github = textField(user?.github?.username, user?.github?.name, user?.github?.email);
  if (github) return github.startsWith('@') ? github : `@${github}`;

  const discord = textField(user?.discord?.username, user?.discord?.email);
  if (discord) return discord;

  const linked = linkedAccountLabel(user);
  if (linked) return linked;

  const address = user?.wallet?.address;
  if (typeof address === 'string' && address.length >= 8) {
    return `${address.slice(0, 5)}...${address.slice(-5)}`;
  }
  if (typeof user?.id === 'string' && user.id.trim()) return user.id.trim();
  return 'Signed in';
}
