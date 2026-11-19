'use client';

import { formatBaseUnits } from '../lib/money-views.mjs';
import { chartLine } from '../lib/wallet-desk.mjs';

export default function EarningsChart({ series }) {
  if (!series) return null;
  const line = chartLine(series.values, 280, 72);
  let figure = '0 USDC';
  try {
    figure = `${formatBaseUnits(series.totalMicro)} USDC`;
  } catch {
    figure = '0 USDC';
  }
  return (
    <figure className="book-earnings" aria-label="Paper PnL">
      <figcaption>
        <strong>{figure}</strong>
        <span>Paper PnL</span>
      </figcaption>
      {line ? (
        <svg viewBox="0 0 280 72" role="img" aria-label="Earnings">
          <path d={line.area} fill={line.up ? 'rgba(61, 190, 106, 0.18)' : 'rgba(225, 6, 0, 0.16)'} />
          <path d={line.d} fill="none" stroke={line.up ? '#3dbe6a' : '#e10600'} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      ) : null}
    </figure>
  );
}
