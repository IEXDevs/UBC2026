export const runtime = 'nodejs';

import { SOLANA_CLUSTER } from '@ubc2026/contracts/solana';
import { createPrivyWalletClient, sanitizeOrigin } from '@ubc2026/wallets/privy';
import { choosePortfolioRpc, loadPortfolio, PortfolioError } from '../../../lib/portfolio.mjs';
import { accessTokenFromRequest } from '../../../lib/privy-cookie-session.mjs';
import { verifyPrivyAccessToken } from '../../../lib/privy-access-token.mjs';
import { readRootEnv } from '../../../lib/root-env.mjs';
import { cloudflareWorkerEnv } from '../../../lib/wallets-cloudflare.mjs';
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

function secretFrom(cfEnv, name) {
  const fromCf = typeof cfEnv?.[name] === 'string' ? cfEnv[name].trim() : '';
  if (fromCf) return fromCf;
  return readRootEnv(name);
}

async function portfolioEnv() {
  const cfEnv = await cloudflareWorkerEnv();
  return {
    onCloudflareWorker: Boolean(cfEnv),
    env: {
      PRIVY_APP_ID: secretFrom(cfEnv, 'PRIVY_APP_ID'),
      PRIVY_APP_SECRET: secretFrom(cfEnv, 'PRIVY_APP_SECRET'),
      PRIVY_AUTHORIZATION_KEY: secretFrom(cfEnv, 'PRIVY_AUTHORIZATION_KEY'),
      NEXT_PUBLIC_PRIVY_APP_ID: secretFrom(cfEnv, 'NEXT_PUBLIC_PRIVY_APP_ID'),
      SOLANA_RPC_URL: secretFrom(cfEnv, 'SOLANA_RPC_URL'),
      QUICKNODE_MAINNET_RPC_URL: secretFrom(cfEnv, 'QUICKNODE_MAINNET_RPC_URL'),
    },
  };
}

function safePortfolioDetail(error) {
  const message = typeof error?.message === 'string' ? error.message.replace(/[\r\n]+/g, ' ').trim() : '';
  if (!message) return '';
  const clipped = message
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/(Bearer\s+)\S+/gi, '$1[redacted]')
    .slice(0, 160);
  if (/secret|api[_-]?key|quicknode|authorization/i.test(clipped)) return '';
  return clipped;
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
  const accessToken = accessTokenFromRequest(request);
  if (!accessToken) {
    return Response.json({ error: 'login_required' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }

  const { env, onCloudflareWorker } = await portfolioEnv();
  const missingPrivy = missingWalletSecrets(env);
  if (missingPrivy.length > 0) {
    return Response.json(
      { error: 'missing_config', missing: missingPrivy },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const requestedCluster = new URL(request.url).searchParams.get('cluster') || '';
  const rpc = choosePortfolioRpc(env, requestedCluster);
  if (!rpc.rpcUrl) {
    return Response.json(
      { error: 'missing_config', missing: rpc.missing },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const appId = resolvePrivyAppId(env);
  let ownerId;
  try {
    ({ sub: ownerId } = await verifyPrivyAccessToken(accessToken, { appId }));
  } catch {
    return Response.json({ error: 'login_required' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  const ownerHeader = request.headers.get('x-owner-id');
  if (ownerHeader !== null && ownerHeader !== ownerId) {
    return Response.json({ error: 'owner_mismatch' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const client = createPrivyWalletClient({
      appId,
      appSecret: env.PRIVY_APP_SECRET,
      rpcUrl: null,
      authorizationKey: env.PRIVY_AUTHORIZATION_KEY || null,
      // Workers cannot set Origin on /users/me. Identity comes from the JWT sub.
      allowUsersMeFallback: !onCloudflareWorker,
    });
    const user = await client.readLoginUser({
      accessToken,
      origin: onCloudflareWorker ? undefined : requestOrigin(request),
      ownerId,
    });
    const wallets = walletsFromPrivyUser(user, ownerId);
    // DexScreener prices are read in the browser so the limit applies to the visitor IP.
    const portfolio = await loadPortfolio({
      wallets,
      rpcUrl: rpc.rpcUrl,
      // Public HTTPS only. A service-binding fetch turns QuickNode into a Worker 404.
      fetcher: globalThis.fetch.bind(globalThis),
    });
    if (requestedCluster === SOLANA_CLUSTER && portfolio.cluster !== (SOLANA_CLUSTER === 'mainnet-beta' ? 'mainnet' : SOLANA_CLUSTER)) throw new PortfolioError('unsupported_cluster');
    return Response.json(portfolio, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const code = error instanceof PortfolioError ? error.code : walletErrorCode(error);
    const status = code === 'missing_config' || code === 'invalid_rpc' || code === 'missing_origin'
      ? 503
      : code === 'login_required' || code === 'owner_mismatch'
        ? 401
        : 502;
    const detail = safePortfolioDetail(error);
    console.error('[api/portfolio]', code);
    return Response.json(
      detail ? { error: code, detail } : { error: code },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
