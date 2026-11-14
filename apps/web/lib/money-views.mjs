/** Chunk 7B view models. Preview rows until the Worker /api routes leave stub status. */

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

export function describePayments(payments, bots) {
  return payments.map(payment => ({
    id: payment.id,
    direction: payment.direction,
    amountLabel: `${formatBaseUnits(payment.amount)} ${payment.asset}`,
    title: payment.counterparty,
    detail: `${botName(bots, payment.botId)} · ${payment.protocol} · ${payment.cluster}`,
  }));
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

export function solscanTxUrl(signature, cluster = 'devnet') {
  if (cluster !== 'devnet' && cluster !== 'testnet') return null;
  if (typeof signature !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(signature)) return null;
  return `https://solscan.io/tx/${signature}?cluster=${cluster}`;
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
    };
  });
}

export function shortAddress(address) {
  if (typeof address !== 'string' || address.length < 12) return address ?? '';
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
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

export function walletGlance(wallets, positions) {
  const main = wallets.find(wallet => wallet.kind === 'main') ?? wallets[0] ?? null;
  return {
    label: main?.label ?? 'Wallet',
    address: main?.address ?? '',
    short: shortAddress(main?.address),
    balanceLabel: glanceBalance(positions),
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
    return {
      id: position.id,
      asset: position.asset,
      amountLabel: `${formatBaseUnits(position.amount, decimals)} ${position.asset}`,
      pnlLabel: `${formatBaseUnits(position.pnlMicroUsdc)} USDC`,
      pnlDown: position.pnlMicroUsdc.startsWith('-'),
      pnlMicroUsdc: position.pnlMicroUsdc,
      notionalMicroUsdc: notional,
      notionalLabel: notional ? `${formatBaseUnits(notional)} USDC` : null,
      botName: botName(bots, position.botId),
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
