import { WalletError } from '@ubc2026/wallets';
import { createPrivyWalletClient } from '@ubc2026/wallets/privy';
import { readRootEnv } from '../../../lib/root-env.mjs';
import { missingWalletSecrets, resolvePrivyAppId } from '../../../lib/wallet-provision.mjs';

function publicWallet(wallet) {
  return {
    id: wallet.id,
    ownerId: wallet.ownerId,
    kind: wallet.kind,
    label: wallet.label,
    address: wallet.address,
    frozen: wallet.frozen,
    provider: wallet.provider,
  };
}

function rootWalletEnv() {
  return {
    PRIVY_APP_ID: readRootEnv('PRIVY_APP_ID'),
    PRIVY_APP_SECRET: readRootEnv('PRIVY_APP_SECRET'),
    QUICKNODE_DEVNET_RPC_URL: readRootEnv('QUICKNODE_DEVNET_RPC_URL'),
    PRIVY_AUTHORIZATION_KEY: readRootEnv('PRIVY_AUTHORIZATION_KEY'),
    NEXT_PUBLIC_PRIVY_APP_ID: readRootEnv('NEXT_PUBLIC_PRIVY_APP_ID'),
  };
}

export async function POST(request) {
  const header = request.headers.get('authorization') ?? '';
  const accessToken = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!accessToken) {
    return Response.json({ error: 'login_required' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }

  const env = rootWalletEnv();
  const missing = missingWalletSecrets(env);
  if (missing.length > 0) {
    return Response.json(
      { error: 'missing_config', missing },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const client = createPrivyWalletClient({
      appId: resolvePrivyAppId(env),
      appSecret: env.PRIVY_APP_SECRET,
      rpcUrl: env.QUICKNODE_DEVNET_RPC_URL,
      authorizationKey: env.PRIVY_AUTHORIZATION_KEY || null,
    });
    const result = await client.acceptLogin({ accessToken });
    return Response.json({
      created: result.created === true,
      wallets: [result.main, ...result.additional].filter(Boolean).map(publicWallet),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const code = error instanceof WalletError ? error.code : 'wallet_failed';
    const status = code === 'missing_config' || code === 'invalid_rpc' ? 503 : 502;
    return Response.json({ error: code }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
