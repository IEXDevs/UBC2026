import { parsePrivySigningFailure } from '@ubc2026/contracts';
import { createPrivyWalletClient } from '@ubc2026/wallets/privy';
import { readStoredWallets, storedWalletRow } from '../../../../lib/connected-deposit.mjs';
import { accessTokenFromRequest } from '../../../../lib/privy-cookie-session.mjs';
import { verifyPrivyAccessToken } from '../../../../lib/privy-access-token.mjs';
import { readRootEnv } from '../../../../lib/root-env.mjs';
import { resolvePrivyAppId } from '../../../../lib/wallet-provision.mjs';

export const runtime = 'nodejs';
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request) {
  const token = accessTokenFromRequest(request);
  if (!token) return json({ error: 'login_required' }, 401);
  const secrets = Object.fromEntries(['PRIVY_APP_ID', 'NEXT_PUBLIC_PRIVY_APP_ID', 'PRIVY_APP_SECRET', 'SOLANA_RPC_URL',
    'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].map(name => [name, readRootEnv(name)]));
  const appId = resolvePrivyAppId(secrets);
  if (!appId || !secrets.PRIVY_APP_SECRET || !secrets.SOLANA_RPC_URL) return json({ error: 'missing_config' }, 503);
  let ownerId;
  try { ({ sub: ownerId } = await verifyPrivyAccessToken(token, { appId })); }
  catch (error) {
    const privy = parsePrivySigningFailure(error?.privyFailure);
    return json({ error: 'login_required', ...(privy ? { privy } : {}) }, 401);
  }
  if (request.headers.has('x-owner-id') && request.headers.get('x-owner-id') !== ownerId) return json({ error: 'owner_mismatch' }, 403);
  const body = await request.json().catch(() => ({}));
  if (!['request', 'sign'].includes(body?.phase)) return json({ error: 'invalid_phase' }, 400);
  try {
    const rows = await readStoredWallets(ownerId, secrets, fetch);
    const stored = rows.map(row => storedWalletRow(row, ownerId)).find(wallet => wallet?.address === body.address);
    if (!stored) return json({ error: 'wallet_not_owned' }, 403);
    const wallet = { ...stored, privyWalletId: stored.id };
    const client = createPrivyWalletClient({ appId, appSecret: secrets.PRIVY_APP_SECRET, rpcUrl: secrets.SOLANA_RPC_URL });
    const expiresAt = body.phase === 'request' ? Date.now() + 60_000 : body.expiresAt;
    const input = { ownerId, wallet, transaction: body.transaction, expiresAt };
    if (body.phase === 'request') return json({ payload: client.ownerAuthorizationPayload(input), expiresAt });
    return json({ signedTransaction: await client.signWithOwnerAuthorization({ ...input, signature: body.signature }) });
  } catch (error) {
    const code = typeof error?.code === 'string' && /^[a-z0-9_]{1,64}$/.test(error.code) ? error.code : 'wallet_owner_authorization_failed';
    const privy = parsePrivySigningFailure(error?.privyFailure);
    return json({ error: code, ...(privy ? { privy } : {}) }, 502);
  }
}
