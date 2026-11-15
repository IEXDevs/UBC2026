'use client';

import { useEffect, useState } from 'react';
import { chartLine, PRICE_PAIRS } from '../lib/wallet-desk.mjs';

export function useTokenSeries(symbol) {
  const [series, setSeries] = useState({ status: 'loading', points: [], caption: '' });

  useEffect(() => {
    const key = typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';
    if (!key) {
      setSeries({ status: 'empty', points: [], caption: 'Choose a token.' });
      return undefined;
    }
    if (key === 'USDC') {
      setSeries({
        status: 'ready',
        points: Array.from({ length: 24 }, () => 1),
        caption: 'USDC reference at 1 USD. devnet execution, mainnet pricing',
      });
      return undefined;
    }
    const pair = PRICE_PAIRS[key];
    if (!pair) {
      setSeries({ status: 'empty', points: [], caption: 'No mainnet series for this token.' });
      return undefined;
    }
    const controller = new AbortController();
    setSeries({ status: 'loading', points: [], caption: 'Loading mainnet price…' });
    fetch(`https://api.binance.com/api/v3/klines?symbol=${pair}&interval=1h&limit=48`, { signal: controller.signal })
      .then(response => (response.ok ? response.json() : Promise.reject(new Error('price_unavailable'))))
      .then(rows => {
        const points = Array.isArray(rows) ? rows.map(row => Number(row?.[4])).filter(Number.isFinite) : [];
        setSeries(points.length > 1
          ? { status: 'ready', points, caption: 'devnet execution, mainnet pricing' }
          : { status: 'empty', points: [], caption: 'No mainnet series for this token.' });
      })
      .catch(error => {
        if (error?.name === 'AbortError') return;
        setSeries({ status: 'empty', points: [], caption: 'Mainnet price is unavailable right now.' });
      });
    return () => controller.abort();
  }, [symbol]);

  return series;
}

export default function PriceGraph({ points = [], caption = '', label = 'Price' }) {
  const line = chartLine(points);
  return (
    <figure className="price-graph">
      {line ? (
        <svg viewBox="0 0 320 96" role="img" aria-label={label}>
          <path d={line.area} fill={line.up ? 'rgba(61, 190, 106, 0.16)' : 'rgba(225, 6, 0, 0.14)'} />
          <path d={line.d} fill="none" stroke={line.up ? '#3dbe6a' : '#e10600'} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      ) : (
        <div className="price-graph-empty" />
      )}
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}
