
import { SOLANA_CLUSTER, explorerClusterQuery } from '@ubc2026/contracts/solana';
/** Money pane view models from live Worker / Privy rows (no preview seeds). */
import { platformBalance } from './platform-send.mjs';

export const MONEY_PANES = Object.freeze({
  History: 'history',
  Wallets: 'wallets',
  Positions: 'positions',
});

export const SOLSCAN_SOLANA = `https://solscan.io/${explorerClusterQuery()}`;

const USDC_DECIMALS = 6;

export function moneyPane(name) {
  return MONEY_PANES[name] ?? null;
}

export function formatBaseUnits(value, decimals = USDC_DECIMALS) {
  if (typeof value !== 'string' || !/^-?(0|[1-9][0-9]{0,39})$/.test(value)) {
    throw new Error('Amount must be an integer string');
  }
  const negative = value.startsWith('-');
  const digits = negative ? value.slice(1) : value;
  if (decimals === 0) return value;
  const padded = digits.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  const shown = fraction ? `${whole}.${fraction}` : whole;
  return negative ? `-${shown}` : shown;
}

function botName(bots, botId) {
  return bots.find(bot => bot.id === botId)?.name ?? botId;
}

export function confirmationBadge(payment) {
  if (!payment || payment.streamConfirmed !== true) return null;
  return payment.badge == null || payment.badge === 'confirmed' ? 'confirmed' : null;
}

export function describePayments(payments, bots) {
  return payments.map(payment => ({
    id: payment.id,
    direction: payment.direction,
    amountLabel: `${formatBaseUnits(payment.amount)} ${payment.asset}`,
    title: payment.counterparty,
    detail: `${botName(bots, payment.botId)} · ${payment.protocol}`,
    badge: confirmationBadge(payment),
  }));
}

export function describeSpendAlerts(checks) {
  if (!Array.isArray(checks)) return [];
  const alerts = [];
  for (const row of checks) {
    if (!row || row.alert !== 'unapproved_spend' || row.freeze !== true) continue;
    if (typeof row.walletId !== 'string' || !row.walletId) continue;
    if (typeof row.excess !== 'string' || !/^(0|[1-9][0-9]{0,39})$/.test(row.excess)) continue;
    const asset = typeof row.asset === 'string' && row.asset.trim() ? row.asset.trim() : 'USDC';
    alerts.push({
      walletId: row.walletId,
      asset,
      excessLabel: formatBaseUnits(row.excess),
    });
  }
  return alerts;
}

export function describeWallets(wallets, bots) {
  return wallets.map(wallet => ({
    id: wallet.id,
    label: wallet.label,
    kind: wallet.kind,
    address: wallet.address,
    frozen: wallet.frozen,
    bots: bots.filter(bot => bot.walletId === wallet.id).map(bot => bot.name),
  }));
}

function txSignature(signature, cluster) {
  if (!['mainnet-beta', 'mainnet', 'devnet', 'testnet'].includes(cluster)) return null;
  if (typeof signature !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(signature)) return null;
  return signature;
}

export function solscanTxUrl(signature, cluster = SOLANA_CLUSTER) {
  const clean = txSignature(signature, cluster);
  if (!clean) return null;
  return `https://solscan.io/tx/${clean}${explorerClusterQuery(cluster)}`;
}

export function solanaExplorerTxUrl(signature, cluster = SOLANA_CLUSTER) {
  const clean = txSignature(signature, cluster);
  if (!clean) return null;
  return `https://explorer.solana.com/tx/${clean}${explorerClusterQuery(cluster)}`;
}

export function describeHistory(payments, bots) {
  return describePayments(payments, bots).map((row, index) => {
    const payment = payments[index];
    const outflow = payment.direction === 'paid';
    const signature = typeof payment.txSignature === 'string' && payment.txSignature
      ? payment.txSignature
      : null;
    return {
      ...row,
      flow: outflow ? 'out' : 'in',
      counterparty: payment.counterparty,
      botName: botName(bots, payment.botId),
      protocol: payment.protocol,
      cluster: payment.cluster,
      asset: payment.asset,
      baseUnits: payment.amount,
      txSignature: signature,
      signedFigure: `${outflow ? '−' : '+'}${formatBaseUnits(payment.amount)}`,
      solscanUrl: solscanTxUrl(payment.txSignature, payment.cluster),
      explorerUrl: solanaExplorerTxUrl(payment.txSignature, payment.cluster),
      legs: Array.isArray(payment.netLegs) ? payment.netLegs : null,
    };
  });
}

export function shortAddress(address) {
  if (typeof address !== 'string' || address.length < 12) return address ?? '';
  return `${address.slice(0, 5)}...${address.slice(-5)}`;
}

/** `EPjFW...TDt1v (Meteora)`. A bot name wins over the wallet label. */
export function walletSendCaption(row) {
  const clipped = shortAddress(typeof row?.address === 'string' ? row.address : '');
  const bot = Array.isArray(row?.bots)
    ? row.bots.find(name => typeof name === 'string' && name.trim())
    : '';
  const label = typeof row?.label === 'string' ? row.label.trim() : '';
  const name = bot ? bot.trim() : label;
  return name ? `${clipped} (${name})` : clipped;
}

/** Other desk wallets for the Send To menu. The active wallet is left out. */
export function sendDestinations(wallets, bots, activeId) {
  const list = Array.isArray(wallets) ? wallets : [];
  return describeWallets(list, Array.isArray(bots) ? bots : [])
    .filter(row => row.id && row.id !== activeId && row.address)
    .map(row => {
      const source = list.find(wallet => wallet?.id === row.id);
      const privy = source?.provider === 'privy';
      return {
        id: row.id,
        address: row.address,
        caption: walletSendCaption(row),
        frozen: Boolean(row.frozen),
        walletKind: row.kind === 'main' ? 'main' : 'additional',
        spendable: privy && source?.spendable !== false && !row.frozen,
      };
    });
}

/** Recent @handles and .sol names from sends, after the wallet menu. */
export function recentCounterparties(transfers = [], payments = []) {
  const seen = new Set();
  const rows = [];
  const sources = [
    ...(Array.isArray(transfers) ? transfers : []),
    ...(Array.isArray(payments) ? payments : []),
  ];
  for (const row of sources) {
    let caption = '';
    if (typeof row?.handle === 'string' && row.handle.trim()) {
      caption = `@${row.handle.trim().replace(/^@/, '')}`;
    } else if (typeof row?.counterparty === 'string') {
      const text = row.counterparty.trim();
      if (text.startsWith('@') || /\.sol$/i.test(text)) caption = text;
    }
    const key = caption.toLowerCase();
    if (!caption || caption.length > 80 || seen.has(key)) continue;
    seen.add(key);
    rows.push({
      id: `recent:${key}`,
      caption,
      kind: 'recent',
      address: '',
      frozen: false,
      spendable: true,
    });
    if (rows.length >= 8) break;
  }
  return rows;
}

export function glanceBalance(positions) {
  let sum = 0n;
  for (const position of positions) {
    if (position.asset !== 'USDC' || position.side === 'borrow') continue;
    if (typeof position.amount !== 'string' || !/^-?(0|[1-9][0-9]*)$/.test(position.amount)) continue;
    sum += BigInt(position.amount);
  }
  return `${formatBaseUnits(sum.toString())} USDC`;
}

function spendableChainLabel(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text || text.length > 180) return '';
  if (!/^[0-9A-Za-z .…·]+$/.test(text)) return '';
  if (!text.includes('SOL') || !text.includes('USDC')) return '';
  return text;
}

export function walletGlance(wallets, positions, transfers = [], chainLabel = null, balanceRead = null) {
  const main = wallets.find(wallet => wallet.kind === 'main') ?? wallets[0] ?? null;
  const platform = Array.isArray(transfers) && transfers.length > 0;
  const chain = spendableChainLabel(chainLabel);
  const failed = balanceRead && balanceRead.ok === false;
  const stale = balanceRead?.stale === true && typeof balanceRead?.asOf === 'string';
  const unavailable = failed
    ? `balance unavailable (${balanceRead.code || 'rpc_failed'})${stale ? ` · stale ${balanceRead.asOf}` : ''}`
    : null;
  return {
    label: main?.label ?? 'Wallet',
    address: main?.address ?? '',
    short: shortAddress(main?.address),
    balanceLabel: unavailable
      || chain
      || (platform ? `${formatBaseUnits(platformBalance(transfers))} USDC` : glanceBalance(positions)),
    balanceStatus: failed ? (balanceRead.code || 'rpc_failed') : (stale ? 'stale' : 'ok'),
    platform,
  };
}

function positionWalletId(position, bots) {
  if (typeof position?.walletId === 'string' && position.walletId) return position.walletId;
  const bot = Array.isArray(bots) ? bots.find(item => item?.id === position?.botId) : null;
  return typeof bot?.walletId === 'string' && bot.walletId ? bot.walletId : null;
}

function sumWalletUsdc(positions, walletId, bots) {
  let sum = 0n;
  for (const position of Array.isArray(positions) ? positions : []) {
    if (!position || position.asset !== 'USDC' || position.side === 'borrow') continue;
    if (positionWalletId(position, bots) !== walletId) continue;
    if (typeof position.amount !== 'string' || !/^-?(0|[1-9][0-9]*)$/.test(position.amount)) continue;
    sum += BigInt(position.amount);
  }
  return sum;
}

function usesPlatformBook(transfers) {
  return Array.isArray(transfers) && transfers.length > 0;
}

/** USDC on the wallet an agent is connected to. The platform book stays on the main wallet. */
export function walletBalanceLabel(walletId, { wallets = [], positions = [], transfers = [], bots = [] } = {}) {
  if (typeof walletId !== 'string' || !walletId) return '0 USDC';
  if (usesPlatformBook(transfers)) {
    const list = Array.isArray(wallets) ? wallets : [];
    const main = list.find(wallet => wallet?.kind === 'main') ?? list[0] ?? null;
    if (main?.id && main.id !== walletId) return '0 USDC';
    return `${formatBaseUnits(platformBalance(transfers))} USDC`;
  }
  return `${formatBaseUnits(sumWalletUsdc(positions, walletId, bots).toString())} USDC`;
}

/** USDC across registered wallets. A mainnet-beta chain label replaces the book. */
export function registeredHoldingsLabel({
  wallets = [],
  positions = [],
  transfers = [],
  bots = [],
  chainLabel = null,
} = {}) {
  const chain = spendableChainLabel(chainLabel);
  if (chain) return chain;
  const list = (Array.isArray(wallets) ? wallets : []).filter(wallet => wallet && wallet.id);
  if (usesPlatformBook(transfers) || list.length < 2) {
    return walletGlance(list, positions, transfers).balanceLabel;
  }
  let sum = 0n;
  for (const wallet of list) sum += sumWalletUsdc(positions, wallet.id, bots);
  return `${formatBaseUnits(sum.toString())} USDC`;
}

function percentFromBps(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,6})$/.test(value)) return null;
  const text = (Number(value) / 100).toFixed(2).replace(/\.?0+$/, '');
  return `${text}%`;
}

function percentWhole(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,2})$/.test(value) || Number(value) > 100) return null;
  return `${value}%`;
}

export function describePositions(positions, bots) {
  return positions.map(position => {
    const decimals = Number.isInteger(position.decimals) && position.decimals >= 0 && position.decimals <= 18
      ? position.decimals
      : USDC_DECIMALS;
    const notional = typeof position.notionalMicroUsdc === 'string' ? position.notionalMicroUsdc : null;
    const named = bots.find(bot => bot.id === position.botId)?.name;
    const holder = typeof position.holder === 'string' && position.holder.trim() ? position.holder.trim() : null;
    return {
      id: position.id,
      asset: position.asset,
      amountLabel: `${formatBaseUnits(position.amount, decimals)} ${position.asset}`,
      pnlLabel: `${formatBaseUnits(position.pnlMicroUsdc)} USDC`,
      pnlDown: position.pnlMicroUsdc.startsWith('-'),
      pnlMicroUsdc: position.pnlMicroUsdc,
      notionalMicroUsdc: notional,
      notionalLabel: notional ? `${formatBaseUnits(notional)} USDC` : null,
      botName: named ?? holder ?? botName(bots, position.botId),
      venue: typeof position.venue === 'string' && position.venue.trim() ? position.venue.trim() : 'Book',
      market: typeof position.market === 'string' && position.market.trim() ? position.market.trim() : position.asset,
      side: typeof position.side === 'string' ? position.side : null,
      entry: typeof position.entry === 'string' ? position.entry : null,
      mark: typeof position.mark === 'string' ? position.mark : null,
      leverage: typeof position.leverage === 'string' && /^(0|[1-9][0-9]{0,2})$/.test(position.leverage)
        ? `${position.leverage}x`
        : null,
      healthLabel: percentWhole(position.healthPct),
      apyLabel: percentFromBps(position.apyBps),
      note: position.quoteSource,
    };
  });
}
