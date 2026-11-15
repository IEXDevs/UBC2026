/**
 * Paper earnings for the positions pane, plus read-only balances
 * from Phantom and other connected wallets.
 * A mainnet price is paper PnL. It never authorizes a transaction.
 */

const AMOUNT = /^(0|[1-9][0-9]{0,39})$/;
const SIGNED = /^-?(0|[1-9][0-9]{0,39})$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const PAPER_PNL_LABEL = 'devnet execution, mainnet pricing';
export const PAPER_PNL_CAPTION = 'Paper PnL. devnet execution, mainnet pricing. A mainnet quote does not authorize a transaction.';

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

/**
 * Cumulative paper PnL. Realized USDC flows come first. Open paper lots
 * add unrealized PnL as the last point. Connected balances are holdings,
 * not earnings.
 */
export function buildEarningsSeries({ positions = [], payments = [], transfers = [] } = {}) {
  const rows = [
    ...(Array.isArray(payments) ? payments : []),
    ...(Array.isArray(transfers) ? transfers : []),
  ];
  const events = [];
  rows.forEach((row, index) => {
    if (row?.asset && row.asset !== 'USDC') return;
    const value = units(row?.amount);
    const sign = flowSign(row?.direction);
    if (value == null || sign == null) return;
    events.push({ at: stamp(row, index), delta: sign * value });
  });
  events.sort((left, right) => left.at - right.at);

  const points = [{ at: 0, micro: '0' }];
  let cursor = 0n;
  for (const event of events) {
    cursor += event.delta;
    points.push({ at: event.at, micro: cursor.toString() });
  }

  let unrealized = 0n;
  for (const position of Array.isArray(positions) ? positions : []) {
    if (!position || position.source === 'connected-balance' || position.readOnly === true) continue;
    if (typeof position.pnlMicroUsdc !== 'string' || !SIGNED.test(position.pnlMicroUsdc)) continue;
    unrealized += BigInt(position.pnlMicroUsdc);
  }
  const total = cursor + unrealized;
  if (points.length === 1 || unrealized !== 0n) {
    points.push({ at: points[points.length - 1].at + 1, micro: total.toString() });
  }

  return {
    points,
    values: points.map(point => microNumber(point.micro)),
    totalMicro: total.toString(),
    label: PAPER_PNL_LABEL,
    paperPnl: true,
    broadcast: false,
    authorizesTransaction: false,
    caption: PAPER_PNL_CAPTION,
  };
}

function externalWallet(wallet) {
  const client = typeof wallet?.client === 'string' ? wallet.client.trim().toLowerCase() : '';
  return client !== '' && client !== 'privy';
}

/**
 * Add read-only balances for Phantom and other connected wallets.
 * Privy agent wallets stay on their paper lots. A portfolio that says it
 * authorizes a transaction is ignored.
 */
export function mergeConnectedPositions({ positions = [], wallets = [], portfolio = null } = {}) {
  const paper = Array.isArray(positions) ? positions.filter(Boolean) : [];
  const baseWallets = Array.isArray(wallets) ? wallets.filter(Boolean) : [];
  const refused = portfolio?.authorizesTransaction !== false || portfolio?.broadcast === true;
  if (!portfolio || refused) {
    return { positions: paper, wallets: baseWallets, broadcast: false, authorizesTransaction: false };
  }
  const cluster = portfolio.cluster;
  if (cluster !== 'mainnet' && cluster !== 'devnet' && cluster !== 'testnet') {
    return { positions: paper, wallets: baseWallets, broadcast: false, authorizesTransaction: false };
  }

  const nextPositions = [...paper];
  const nextWallets = baseWallets.map(wallet => ({ ...wallet }));
  const seen = new Set(nextPositions.map(row => row.id));
  for (const wallet of Array.isArray(portfolio.wallets) ? portfolio.wallets : []) {
    if (!externalWallet(wallet) || typeof wallet.address !== 'string' || !BASE58.test(wallet.address)) continue;
    const existing = nextWallets.find(item => item.address === wallet.address);
    const id = existing?.id || `connected_${wallet.address.slice(0, 8)}`;
    if (existing) {
      existing.readOnly = true;
      existing.spendable = false;
    } else {
      nextWallets.push({
        id,
        label: typeof wallet.label === 'string' && wallet.label.trim() ? wallet.label.trim() : 'Wallet',
        address: wallet.address,
        kind: 'connected',
        frozen: false,
        spendable: false,
        readOnly: true,
        provider: wallet.client,
      });
    }
    for (const holding of wallet.holdings || []) {
      if (!holding || typeof holding.mint !== 'string' || !BASE58.test(holding.mint)) continue;
      if (!units(holding.amount) || holding.amount === '0') continue;
      if (!Number.isInteger(holding.decimals) || holding.decimals < 0 || holding.decimals > 18) continue;
      const positionId = `connected:${wallet.address}:${holding.mint}`;
      if (seen.has(positionId)) continue;
      seen.add(positionId);
      const priced = typeof holding.usdMicro === 'string' && AMOUNT.test(holding.usdMicro) && holding.usdMicro !== '0';
      const mainnet = cluster === 'mainnet';
      nextPositions.push({
        id: positionId,
        botId: null,
        walletId: id,
        holder: typeof wallet.label === 'string' && wallet.label.trim() ? wallet.label.trim() : 'Wallet',
        asset: typeof holding.symbol === 'string' && holding.symbol.trim() ? holding.symbol.trim() : 'Token',
        mint: holding.mint,
        amount: holding.amount,
        decimals: holding.decimals,
        pnlMicroUsdc: '0',
        notionalMicroUsdc: priced ? holding.usdMicro : null,
        quoteSource: mainnet ? 'mainnet price' : `${cluster} balance`,
        venue: 'Balance',
        market: mainnet ? 'mainnet price' : `${cluster} balance`,
        side: 'balance',
        source: 'connected-balance',
        readOnly: true,
        broadcast: false,
        cluster,
      });
    }
  }

  return {
    positions: nextPositions,
    wallets: nextWallets,
    broadcast: false,
    authorizesTransaction: false,
    label: PAPER_PNL_LABEL,
  };
}
