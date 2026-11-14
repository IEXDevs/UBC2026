import { WalletError } from '@ubc2026/wallets';
import { createPrivyWalletClient } from '@ubc2026/wallets/privy';
import { readRootEnv } from '../../../lib/root-env.mjs';

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

export async function POST(request) {
  const header = request.headers.get('authorization') ?? '';
  const accessToken = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!accessToken) {
    return Response.json({ error: 'login_required' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  const authorizationKey = readRootEnv('PRIVY_AUTHORIZATION_KEY');
  try {
    const client = createPrivyWalletClient({
      appId: readRootEnv('PRIVY_APP_ID'),
      appSecret: readRootEnv('PRIVY_APP_SECRET'),
      rpcUrl: readRootEnv('QUICKNODE_DEVNET_RPC_URL'),
      authorizationKey: authorizationKey || null,
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
