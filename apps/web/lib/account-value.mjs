import { formatUsdMicro } from './portfolio.mjs';

/** Read-only total from the portfolio, never a spend balance or authorization. */
export function accountValueLabel(portfolio) {
  const total = portfolio?.totalUsdMicro;
  if (typeof total !== 'string' || !/^(0|[1-9][0-9]{0,39})$/.test(total)) return '— USD';
  const partial = Number(portfolio.unpriced) > 0;
  if (partial && total === '0') return '— USD';
  return `${partial ? '≥ ' : ''}${formatUsdMicro(total)}`;
}
