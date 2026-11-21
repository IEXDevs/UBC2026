import { formatUsdMicro } from './portfolio.mjs';

export function hasAccountValue(portfolio) {
  const total = portfolio?.totalUsdMicro;
  return typeof total === 'string' && /^(0|[1-9][0-9]{0,39})$/.test(total)
    && !(total === '0' && Number(portfolio.unpriced) > 0);
}

/** Read-only total from the portfolio, never a spend balance or authorization. */
export function accountValueLabel(portfolio) {
  if (!hasAccountValue(portfolio)) return '— USD';
  const partial = Number(portfolio.unpriced) > 0;
  return `${partial ? '≥ ' : ''}${formatUsdMicro(portfolio.totalUsdMicro)}`;
}
