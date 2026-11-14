/**
 * Privy login settings for the glass shell.
 * App id and client id are public. Never put PRIVY_APP_SECRET or an RPC URL here.
 */

const SOLANA_LOGIN = Object.freeze({
  appearance: Object.freeze({
    theme: 'dark',
    accentColor: '#3dd6c6',
    walletChainType: 'solana-only',
  }),
  loginMethods: Object.freeze(['email', 'wallet']),
  embeddedWallets: Object.freeze({
    solana: Object.freeze({ createOnLogin: 'users-without-wallets' }),
  }),
});

function publicId(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes(' ') || trimmed.length > 128) return '';
  return trimmed;
}

export function privyProviderProps({ appId, clientId } = {}) {
  const id = publicId(appId);
  if (!id) return null;
  const props = {
    appId: id,
    config: {
      appearance: { ...SOLANA_LOGIN.appearance },
      loginMethods: [...SOLANA_LOGIN.loginMethods],
      embeddedWallets: {
        solana: { ...SOLANA_LOGIN.embeddedWallets.solana },
      },
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

export function privyAccountLabel(user) {
  const email = user?.email?.address;
  if (typeof email === 'string' && email.trim()) return email.trim();
  const address = user?.wallet?.address;
  if (typeof address === 'string' && address.length >= 8) {
    return `${address.slice(0, 4)}…${address.slice(-4)}`;
  }
  if (typeof user?.id === 'string' && user.id.trim()) return user.id.trim();
  return 'Signed in';
}
