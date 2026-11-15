/** Money pane view models from live Worker / Privy rows (no preview seeds). */
import { platformBalance } from './platform-send.mjs';

export const MONEY_PANES = Object.freeze({
  History: 'history',
  Wallets: 'wallets',
  Positions: 'positions',
});

export const SOLSCAN_DEVNET = 'https://solscan.io/?cluster=devnet';

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
    detail: `${botName(bots, payment.botId)} · ${payment.protocol} · ${payment.cluster}`,
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
  if (cluster !== 'devnet' && cluster !== 'testnet' && cluster !== 'mainnet') return null;
  if (typeof signature !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(signature)) return null;
  return signature;
}

export function solscanTxUrl(signature, cluster = 'devnet') {
  const clean = txSignature(signature, cluster);
  if (!clean) return null;
  if (cluster === 'mainnet') return `https://solscan.io/tx/${clean}`;
  return `https://solscan.io/tx/${clean}?cluster=${cluster}`;
}

export function solanaExplorerTxUrl(signature, cluster = 'devnet') {
  if (cluster !== 'devnet' && cluster !== 'testnet') return null;
  const clean = txSignature(signature, cluster);
  if (!clean) return null;
  return `https://explorer.solana.com/tx/${clean}?cluster=${cluster}`;
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

export function glanceBalance(positions) {
  let sum = 0n;
  for (const position of positions) {
    if (position.asset !== 'USDC' || position.side === 'borrow') continue;
    if (typeof position.amount !== 'string' || !/^-?(0|[1-9][0-9]*)$/.test(position.amount)) continue;
    sum += BigInt(position.amount);
  }
  return `${formatBaseUnits(sum.toString())} USDC`;
}

export function walletGlance(wallets, positions, transfers = []) {
  const main = wallets.find(wallet => wallet.kind === 'main') ?? wallets[0] ?? null;
  const platform = Array.isArray(transfers) && transfers.length > 0;
  return {
    label: main?.label ?? 'Wallet',
    address: main?.address ?? '',
    short: shortAddress(main?.address),
    balanceLabel: platform ? `${formatBaseUnits(platformBalance(transfers))} USDC` : glanceBalance(positions),
    platform,
  };
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
      note: `devnet execution, mainnet pricing · ${position.quoteSource}`,
    };
  });
}
