export const runtime = 'nodejs';

import { readRootEnv } from '../../../lib/root-env.mjs';
import { handleSolanaBalanceRequest } from '../../../lib/solana-balance-read.mjs';

/** Confirmed mainnet-beta SOL and USDC. Works with no agent-runtime URL and no QuickNode secret. */
export async function GET(request) {
  const result = await handleSolanaBalanceRequest(request, { readEnv: readRootEnv });
  return Response.json(result.body, {
    status: result.status,
    headers: { 'Cache-Control': 'no-store' },
  });
}
