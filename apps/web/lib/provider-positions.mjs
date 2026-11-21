import { SOLANA_CLUSTER } from '@ubc2026/contracts/solana';
import { formatBaseUnits } from './money-views.mjs';

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MICRO = /^-?(0|[1-9][0-9]{0,29})$/;
const DOLLARS = /^(-?)(0|[1-9][0-9]{0,23})(?:\.([0-9]{1,30}))?$/;
const MAX_METEORA_PAGES = 3;

function microUsd(value) {
  if (typeof value !== 'string' || !MICRO.test(value)) return null;
  return BigInt(value).toString();
}

function dollarsToMicro(value) {
  const match = typeof value === 'string' && DOLLARS.exec(value);
  if (!match) return null;
  const [, sign, whole, fraction = ''] = match;
  return BigInt(`${sign}${whole}${fraction.padEnd(6, '0').slice(0, 6)}`).toString();
}

function symbol(value) {
  return typeof value === 'string' && /^[A-Za-z0-9.+_-]{1,16}$/.test(value) ? value : 'Token';
}

function price(value) {
  const raw = microUsd(value);
  return raw !== null && BigInt(raw) > 0n ? `$${formatBaseUnits(raw)}` : null;
}

async function read(fetcher, url, signal) {
  const response = await fetcher(url, { redirect: 'manual', signal });
  if (!response.ok) throw new Error('provider_read_failed');
  return response.json();
}

async function jupiterPositions(address, fetcher, signal, add) {
  const url = new URL('https://perps-api.jup.ag/v1/positions');
  url.searchParams.set('walletAddress', address);
  url.searchParams.set('includeClosedPositions', 'false');
  const body = await read(fetcher, url, signal);
  if (!Array.isArray(body?.dataList)) throw new Error('provider_response_invalid');
  for (const position of body.dataList) {
    const { positionPubkey, assetMint, side } = position ?? {};
    const size = microUsd(position?.sizeUsd);
    if (!ADDRESS.test(positionPubkey ?? '') || !size || BigInt(size) <= 0n || !['long', 'short'].includes(side)) continue;
    const asset = symbol(position.asset);
    add({
      id: `jupiter:${address}:${positionPubkey}`, venue: 'Jupiter', asset, market: `${asset} Perp`, side,
      mint: ADDRESS.test(assetMint ?? '') ? assetMint : null, positionAddress: positionPubkey,
      sizeLabel: `$${formatBaseUnits((BigInt(size) / 10000n).toString(), 2)} size`, notionalMicroUsdc: microUsd(position.valueUsd),
      pnlMicroUsdc: microUsd(position.pnlAfterFeesUsd), entry: price(position.entryPriceUsd), mark: price(position.markPriceUsd),
      leverage: typeof position.leverage === 'string' ? position.leverage : null,
      quoteSource: 'Jupiter Perps',
    });
  }
}

async function meteoraPositions(address, fetcher, signal, add) {
  const url = new URL('https://dlmm.datapi.meteora.ag/portfolio/open');
  url.searchParams.set('user', address);
  url.searchParams.set('page_size', '50');
  for (let page = 1; page <= MAX_METEORA_PAGES; page += 1) {
    url.searchParams.set('page', String(page));
    const body = await read(fetcher, url, signal);
    if (!Array.isArray(body?.pools) || typeof body.hasNext !== 'boolean') throw new Error('provider_response_invalid');
    for (const pool of body.pools) {
      const { poolAddress, openPositionCount } = pool ?? {};
      if (!ADDRESS.test(poolAddress ?? '') || !Number.isSafeInteger(openPositionCount) || openPositionCount < 1) continue;
      const asset = `${symbol(pool.tokenX)} / ${symbol(pool.tokenY)}`;
      add({
        id: `meteora:${address}:${poolAddress}`, venue: 'Meteora', asset, market: asset, side: 'liquidity',
        positionAddress: poolAddress, sizeLabel: `${openPositionCount} open`, notionalMicroUsdc: dollarsToMicro(pool.balances),
        pnlMicroUsdc: dollarsToMicro(pool.pnl), quoteSource: 'Meteora DLMM · pool totals',
      });
    }
    if (!body.hasNext) return;
  }
  throw new Error('provider_response_partial');
}

export async function loadProviderPositions(wallets, { fetcher = fetch } = {}) {
  const providers = [['Jupiter', jupiterPositions], ['Meteora', meteoraPositions]];
  const addresses = [...new Set(wallets.map(wallet => wallet.address).filter(address => ADDRESS.test(address ?? '')))];
  const groups = await Promise.all(providers.map(async ([venue, load]) => {
    const rows = new Map();
    const signal = AbortSignal.timeout(6500);
    const reads = await Promise.allSettled(addresses.map(async address => {
      await load(address, fetcher, signal, row => rows.set(row.id, { ...row, walletAddress: address, cluster: SOLANA_CLUSTER }));
    }));
    return { venue, rows: [...rows.values()], incomplete: reads.some(result => result.status === 'rejected') };
  }));
  return {
    positions: groups.flatMap(group => group.rows),
    incomplete: groups.filter(group => group.incomplete).map(group => group.venue),
  };
}
