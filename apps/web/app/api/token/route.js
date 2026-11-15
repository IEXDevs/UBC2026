export const runtime = 'nodejs';

import { CHART_RANGES, loadTokenMarket, TokenMarketError } from '../../../lib/token-market.mjs';

const CLUSTERS = new Set(['mainnet', 'devnet', 'testnet']);

export async function GET(request) {
  const url = new URL(request.url);
  const mint = url.searchParams.get('mint') || '';
  const range = url.searchParams.get('range') || '1D';
  const clusterParam = url.searchParams.get('cluster') || 'mainnet';
  const cluster = CLUSTERS.has(clusterParam) ? clusterParam : 'mainnet';
  if (!CHART_RANGES.includes(range)) {
    return Response.json({ error: 'invalid_range' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const view = await loadTokenMarket({ mint, range, cluster });
    return Response.json(view, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const code = error instanceof TokenMarketError ? error.code : 'token_failed';
    const status = code === 'invalid_mint' || code === 'invalid_range' ? 400 : 502;
    console.error('[api/token]', code);
    return Response.json({ error: code }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
