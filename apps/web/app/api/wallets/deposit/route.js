export const runtime = 'nodejs';

import { postConnectedDeposit } from '../../../../lib/connected-deposit.mjs';

export async function POST(request) {
  return postConnectedDeposit(request);
}
