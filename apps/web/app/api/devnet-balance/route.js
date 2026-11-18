export const runtime = 'nodejs';

import { readRootEnv } from '../../../lib/root-env.mjs';
import { handleDevnetBalanceRequest } from '../../../lib/devnet-balance-read.mjs';

/** Confirmed devnet SOL and USDC. Works with no agent-runtime URL and no QuickNode secret. */
export async function GET(request) {
  const result = await handleDevnetBalanceRequest(request, { readEnv: readRootEnv });
  return Response.json(result.body, {
    status: result.status,
    headers: { 'Cache-Control': 'no-store' },
  });
}
