import { SOLANA_CLUSTER } from '@ubc2026/contracts/solana';
import { SOL_MINT } from './portfolio.mjs';

const AMOUNT = /^(0|[1-9][0-9]{0,39})$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

function units(value) {
  return typeof value === 'string' && AMOUNT.test(value) ? BigInt(value) : null;
}

function microNumber(micro) {
  const negative = micro.startsWith('-');
  const digits = negative ? micro.slice(1) : micro;
  if (!AMOUNT.test(digits)) return 0;
  const padded = digits.padStart(7, '0');
  const whole = padded.slice(0, -6);
  const cents = padded.slice(-6, -4);
  const value = Number(`${whole}.${cents}`);
  if (!Number.isFinite(value)) return 0;
  return negative ? -value : value;
}

function stamp(row, index) {
  const at = row?.createdAt ?? row?.at;
  return Number.isSafeInteger(at) && at > 0 ? at : index + 1;
}

function flowSign(direction) {
  if (direction === 'earned' || direction === 'in') return 1n;
  if (direction === 'paid' || direction === 'out') return -1n;
  return null;
}


export function buildEarningsSeries({ payments = [] } = {}) {
  const seen = new Set();
  const events = [];
  (Array.isArray(payments) ? payments : []).forEach((row, index) => {
    const signature = row?.txSignature;
    if (row?.streamConfirmed !== true || row.cluster !== SOLANA_CLUSTER || row.asset !== 'USDC'
        || typeof signature !== 'string' || !SIGNATURE.test(signature) || seen.has(signature)) return;
    const value = units(row.amount);
    const sign = flowSign(row.direction);
    if (value == null || sign == null) return;
    seen.add(signature);
    events.push({ at: stamp(row, index), delta: sign * value });
  });
  if (!events.length) return null;
  events.sort((left, right) => left.at - right.at);
  const points = [{ at: 0, micro: '0' }];
  let net = 0n;
  for (const event of events) {
    net += event.delta;
    points.push({ at: event.at, micro: net.toString() });
  }
  return { points, values: points.map(point => microNumber(point.micro)), totalMicro: net.toString(), label: 'Net USDC flow' };
}

function connectedClient(wallet) {
  const client = typeof wallet?.client === 'string' ? wallet.client.trim().toLowerCase() : '';
  return client !== '' && client !== 'privy' && client !== 'privy-v2';
}

export function mergeWalletPositions({ wallets = [], portfolio = null, retiredIds = [] } = {}) {
  const retired = new Set(Array.isArray(retiredIds) ? retiredIds.map(id => (typeof id === 'string' ? id.trim() : id)).filter(Boolean) : []);
  const byAddress = new Map();
  for (const wallet of wallets) {
    if (wallet && typeof wallet.address === 'string' && BASE58.test(wallet.address) && !byAddress.has(wallet.address)) {
      if (retired.has(wallet.id) || retired.has(wallet.address)) continue;
      byAddress.set(wallet.address, { ...wallet });
    }
  }
  const cluster = SOLANA_CLUSTER === 'mainnet-beta' ? 'mainnet' : SOLANA_CLUSTER;
  const verifiedPortfolio = portfolio?.authorizesTransaction === false && portfolio.broadcast !== true && portfolio.cluster === cluster;
  const linked = verifiedPortfolio && Array.isArray(portfolio.wallets) ? portfolio.wallets : [];
  const priced = new Map();
  for (const wallet of linked) {
    if (!wallet || typeof wallet.address !== 'string' || !BASE58.test(wallet.address)) continue;
    if (retired.has(wallet.id) || retired.has(wallet.address)) continue;
    priced.set(wallet.address, wallet.holdings);
    const connected = connectedClient(wallet);
    const record = byAddress.get(wallet.address) ?? {
      id: `wallet_${wallet.address}`, address: wallet.address, label: wallet.label || 'Wallet',
      kind: connected ? 'connected' : 'additional', provider: wallet.client,
    };
    if (connected) Object.assign(record, { readOnly: true, spendable: false });
    byAddress.set(wallet.address, record);
  }

  const holdingsRows = [];
  for (const wallet of byAddress.values()) {
    if (retired.has(wallet.id) || retired.has(wallet.address)) continue;
    const chainRows = (wallet.holdings || []).filter(row => row?.cluster === SOLANA_CLUSTER).map(row => {
      if (row.asset === 'SOL' && !row.mint) return { ...row, mint: SOL_MINT, native: true };
      if (row.mint === SOL_MINT) return { ...row, symbol: 'wSOL', native: false };
      return row;
    });
    const linkedRows = priced.get(wallet.address);
    const holdings = Array.isArray(linkedRows) ? linkedRows : chainRows;
    const seen = new Set();
    for (const holding of holdings) {
      if (!holding || typeof holding.mint !== 'string' || !BASE58.test(holding.mint)
          || !units(holding.amount) || !Number.isInteger(holding.decimals)
          || holding.decimals < 0 || holding.decimals > 18) continue;
      const key = holding.native === false ? `${holding.mint}:wrapped` : holding.mint;
      if (seen.has(key)) continue;
      seen.add(key);
      holdingsRows.push({
        id: `wallet:${wallet.address}:${key}`,
        botId: null, walletId: wallet.id, holder: wallet.label || 'Wallet',
        asset: typeof holding.symbol === 'string' && holding.symbol.trim() ? holding.symbol.trim() : 'Token',
        mint: holding.mint, amount: holding.amount, decimals: holding.decimals,
        notionalMicroUsdc: units(holding.usdMicro) != null ? holding.usdMicro : null,
        quoteSource: 'Wallet balance', venue: 'Balance', side: 'balance',
        readOnly: wallet.readOnly === true, cluster: SOLANA_CLUSTER,
      });
    }
  }
  const providerRows = verifiedPortfolio && Array.isArray(portfolio.providers?.positions) ? portfolio.providers.positions : [];
  const positions = [];
  for (const position of providerRows) {
    if (!position || (position.walletAddress && retired.has(position.walletAddress))) continue;
    const wallet = byAddress.get(position?.walletAddress);
    if (!wallet || position.cluster !== SOLANA_CLUSTER) continue;
    positions.push({ ...position, walletId: wallet.id, holder: wallet.label || 'Wallet', readOnly: wallet.readOnly === true });
  }
  return { positions, holdings: holdingsRows, wallets: [...byAddress.values()] };
}
