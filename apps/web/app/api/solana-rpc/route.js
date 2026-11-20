import { readRootEnv } from '../../../lib/root-env.mjs';

export const runtime = 'nodejs';
const MAX_BYTES = 65536;
const METHODS = new Set([
  'getLatestBlockhash', 'getFeeForMessage', 'simulateTransaction', 'getAccountInfo', 'getMultipleAccounts',
  'getBalance', 'getTokenAccountsByOwner', 'getTokenAccountBalance', 'getMinimumBalanceForRentExemption',
  'getSignatureStatuses', 'getRecentPrioritizationFees', 'getSlot', 'getEpochInfo', 'getGenesisHash',
]);
const json = (body, status) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request) {
  if (Number(request.headers.get('content-length')) > MAX_BYTES) return json({ error: 'request_too_large' }, 413);
  let body;
  try {
    const reader = request.body?.getReader();
    if (!reader) return json({ error: 'invalid_request' }, 400);
    const chunks = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) {
        await reader.cancel();
        return json({ error: 'request_too_large' }, 413);
      }
      chunks.push(value);
    }
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { return json({ error: 'invalid_request' }, 400); }
  const calls = Array.isArray(body) ? body : [body];
  if (!calls.length || calls.length > 20 || calls.some(call => !call || call.jsonrpc !== '2.0'
      || !METHODS.has(call.method) || (call.params !== undefined && !Array.isArray(call.params)))) {
    return json({ error: 'rpc_method_not_allowed' }, 400);
  }
  const url = readRootEnv('SOLANA_RPC_URL');
  if (!url) return json({ error: 'missing_config' }, 503);
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(15000) });
    if (!response.ok) return json({ error: 'rpc_unavailable' }, 502);
    const result = await response.json();
    for (const [index, item] of (Array.isArray(result) ? result : [result]).entries()) {
      const call = calls[index] || calls[0];
      const err = item?.error?.code || item?.result?.value?.err;
      console.log('[solana-rpc]', JSON.stringify({ method: call?.method, rpcError: item?.error?.code ?? null,
        simErr: call?.method === 'simulateTransaction' ? (item?.result?.value?.err ?? null) : undefined,
        logs: call?.method === 'simulateTransaction' && err ? (item?.result?.value?.logs || []).slice(-6) : undefined }));
    }
    return json(result, 200);
  } catch { return json({ error: 'rpc_unavailable' }, 502); }
}
