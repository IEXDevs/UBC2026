'use client';

import { formatBaseUnits } from '../lib/money-views.mjs';
import AddressCopy from './AddressCopy';
import { formatShare, formatUsdMicro } from '../lib/portfolio.mjs';

const COLORS = ['#3dd6c6', '#f5f5f5', '#7eb6ff', '#f0c36a', '#f07171', '#c4b5fd', '#a3a3a3'];

function colorFor(index) {
  return COLORS[index % COLORS.length];
}

function Ring({ slices }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  if (slices.length === 0) {
    return (
      <svg className="portfolio-ring" viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="#2a2a2a" strokeWidth="14" />
      </svg>
    );
  }
  return (
    <svg className="portfolio-ring" viewBox="0 0 120 120" aria-hidden="true">
      <g transform="rotate(-90 60 60)">
        {slices.map((slice, index) => {
          const length = (slice.shareBps / 10000) * circumference;
          const dash = `${length} ${circumference - length}`;
          const node = (
            <circle
              key={slice.mint}
              cx="60"
              cy="60"
              r={radius}
              fill="none"
              stroke={colorFor(index)}
              strokeWidth="14"
              strokeDasharray={dash}
              strokeDashoffset={-offset}
            />
          );
          offset += length;
          return node;
        })}
      </g>
    </svg>
  );
}

export default function PortfolioGraph({
  portfolio,
  error = '',
  loading = false,
  onConnect,
  onRemove,
  removing = '',
}) {
  const slices = Array.isArray(portfolio?.slices) ? portfolio.slices : [];
  const wallets = Array.isArray(portfolio?.wallets) ? portfolio.wallets : [];
  const total = typeof portfolio?.totalUsdMicro === 'string' ? portfolio.totalUsdMicro : '0';

  return (
    <div className="portfolio">
      <div className="portfolio-actions">
        <button type="button" className="ghost" onClick={onConnect}>Link a wallet</button>
        <p className="quiet">Linked wallets are read for this graph. Agents do not spend from them.</p>
      </div>
      {loading ? <p className="quiet">Reading wallets from QuickNode…</p> : null}
      {error ? <p className="quiet" role="status">{error}</p> : null}
      {portfolio && !loading ? (
        <>
          <div className="portfolio-layout">
            <Ring slices={slices} />
            <div>
              {slices.length ? <p className="wallet-figure">{formatUsdMicro(total)}</p> : null}
              {slices.length === 0 ? <p className="quiet">No assets in the linked wallets yet.</p> : (
                <ul className="portfolio-legend">
                  {slices.map((slice, index) => (
                    <li key={slice.mint}>
                      <i style={{ background: colorFor(index) }} />
                      <strong>{slice.symbol}</strong>
                      <span>{formatShare(slice.shareBps)}</span>
                      <small>{formatUsdMicro(slice.usdMicro)}</small>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <ul className="wallet-list">
            {wallets.length === 0 ? <li><strong>No wallet linked</strong><small>Connect one to start the graph.</small></li> : null}
            {wallets.map(wallet => (
              <li key={wallet.address}>
                <div className="portfolio-wallet-head">
                  <strong>{wallet.label}</strong>
                  {wallet.spendable ? null : (
                    <button
                      type="button"
                      className="portfolio-remove"
                      onClick={() => onRemove?.(wallet.address)}
                      disabled={removing === wallet.address}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <AddressCopy address={wallet.address} />
                <span>{formatUsdMicro(wallet.totalUsdMicro || '0')}</span>
                <div className="portfolio-bar" aria-hidden="true">
                  {wallet.holdings?.filter(row => row.usdMicro !== '0').map(row => {
                    const sliceIndex = slices.findIndex(slice => slice.mint === row.mint);
                    const width = wallet.totalUsdMicro && wallet.totalUsdMicro !== '0'
                      ? Number((BigInt(row.usdMicro) * 10000n) / BigInt(wallet.totalUsdMicro)) / 100
                      : 0;
                    return (
                      <i
                        key={row.mint}
                        style={{ width: `${width}%`, background: colorFor(sliceIndex < 0 ? 0 : sliceIndex) }}
                      />
                    );
                  })}
                </div>
                {wallet.holdings?.length ? (
                  <small>
                    {wallet.holdings.filter(row => row.usdMicro !== '0').map(row => `${formatBaseUnits(row.amount, row.decimals)} ${row.symbol}`).join(' · ')
                      || 'No priced balance'}
                    {wallet.holdings.some(row => row.usdMicro === '0')
                      ? ` · ${wallet.holdings.filter(row => row.usdMicro === '0').length} unpriced`
                      : ''}
                  </small>
                ) : <small>{wallet.spendable ? 'Agent wallet' : 'Connected'}</small>}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
