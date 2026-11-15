export const runtime = 'nodejs';

import { createMainnetPriceProvider } from '@ubc2026/prices';
import { createPrivyWalletClient, sanitizeOrigin } from '@ubc2026/wallets/privy';
import { choosePortfolioRpc, loadPortfolio, PortfolioError } from '../../../lib/portfolio.mjs';
import { readRootEnv } from '../../../lib/root-env.mjs';
import { missingWalletSecrets, resolvePrivyAppId, walletsFromPrivyUser } from '../../../lib/wallet-provision.mjs';

function requestOrigin(request) {
  const fromOrigin = sanitizeOrigin(request.headers.get('origin'));
  if (fromOrigin) return fromOrigin;
  const referer = request.headers.get('referer');
  if (typeof referer === 'string' && referer.trim()) {
    try { return sanitizeOrigin(new URL(referer.trim()).origin); } catch { /* ignore */ }
  }
  return 'http://localhost:3000';
}

function rootEnv() {
  return {
    PRIVY_APP_ID: readRootEnv('PRIVY_APP_ID'),
    PRIVY_APP_SECRET: readRootEnv('PRIVY_APP_SECRET'),
    PRIVY_AUTHORIZATION_KEY: readRootEnv('PRIVY_AUTHORIZATION_KEY'),
    NEXT_PUBLIC_PRIVY_APP_ID: readRootEnv('NEXT_PUBLIC_PRIVY_APP_ID'),
    QUICKNODE_DEVNET_RPC_URL: readRootEnv('QUICKNODE_DEVNET_RPC_URL'),
    QUICKNODE_MAINNET_RPC_URL: readRootEnv('QUICKNODE_MAINNET_RPC_URL'),
  };
}

function walletErrorCode(error) {
  if (!error || typeof error !== 'object') return 'portfolio_failed';
  if (error.name !== 'WalletError' && error.constructor?.name !== 'WalletError' && error.name !== 'PortfolioError') {
    return 'portfolio_failed';
  }
  const code = typeof error.code === 'string' && /^[a-z0-9_]{1,64}$/.test(error.code) ? error.code : 'portfolio_failed';
  return code;
}

export async function GET(request) {
  const header = request.headers.get('authorization') ?? '';
  const accessToken = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!accessToken) {
    return Response.json({ error: 'login_required' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }

  const env = rootEnv();
  const missingPrivy = missingWalletSecrets(env);
  if (missingPrivy.length > 0) {
    return Response.json(
      { error: 'missing_config', missing: missingPrivy },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const rpc = choosePortfolioRpc(env);
  if (!rpc.rpcUrl) {
    return Response.json(
      { error: 'missing_config', missing: rpc.missing },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const client = createPrivyWalletClient({
      appId: resolvePrivyAppId(env),
      appSecret: env.PRIVY_APP_SECRET,
      rpcUrl: null,
      authorizationKey: env.PRIVY_AUTHORIZATION_KEY || null,
    });
    const ownerHeader = request.headers.get('x-owner-id');
    const user = await client.readLoginUser({
      accessToken,
      origin: requestOrigin(request),
      ownerId: typeof ownerHeader === 'string' && ownerHeader.trim() ? ownerHeader.trim() : undefined,
    });
    const ownerId = typeof user?.id === 'string' && user.id.trim()
      ? user.id.trim()
      : (typeof ownerHeader === 'string' ? ownerHeader.trim() : '');
    const wallets = walletsFromPrivyUser(user, ownerId);
    const portfolio = await loadPortfolio({
      wallets,
      rpcUrl: rpc.rpcUrl,
      lookupPrice: createMainnetPriceProvider(),
    });
    return Response.json(portfolio, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const code = error instanceof PortfolioError ? error.code : walletErrorCode(error);
    const status = code === 'missing_config' || code === 'invalid_rpc' || code === 'missing_origin' ? 503 : 502;
    console.error('[api/portfolio]', code);
    return Response.json({ error: code }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
