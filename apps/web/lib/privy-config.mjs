/**
 * Privy login settings for the glass shell.
 * App id and client id are public. Never put PRIVY_APP_SECRET or an RPC URL here.
 * Dashboard login methods: Email, Google, GitHub, Discord, and Solana wallets.
 * Ethereum wallet login and Ethereum embedded wallets stay off.
 * Signup creates a Solana embedded wallet for every user.
 * Dashboard MFA (authenticator app and passkey) stays enabled; prompts use Privy's UI.
 */

const SOLANA_WALLETS = Object.freeze([
  'detected_solana_wallets',
  'phantom',
  'solflare',
  'backpack',
  'jupiter',
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
  // Do not mirror the session into document cookies. On localhost those
  // Secure cookie writes vanish on refresh and look like a wiped login.
  // Auth stays in localStorage (`privy:token` / `privy:refresh_token`).
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
      sessions: { ...SOLANA_LOGIN.sessions },
    },
  };
  const client = publicId(clientId);
  if (client) props.clientId = client;
  return props;
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
    return `${address.slice(0, 4)}…${address.slice(-4)}`;
  }
  if (typeof user?.id === 'string' && user.id.trim()) return user.id.trim();
  return 'Signed in';
}
