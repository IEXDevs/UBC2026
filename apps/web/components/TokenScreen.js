'use client';

import { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import TokenChart from './TokenChart';
import { formatBaseUnits } from '../lib/money-views.mjs';
import { formatUsdMicro } from '../lib/portfolio.mjs';
import {
  CHART_RANGES,
  combineHoldings,
  formatTokenPrice,
} from '../lib/token-market.mjs';
import { portfolioErrorNote } from '../lib/portfolio.mjs';

function linkedKey(user) {
  const accounts = Array.isArray(user?.linkedAccounts)
    ? user.linkedAccounts
    : (Array.isArray(user?.linked_accounts) ? user.linked_accounts : []);
  return accounts.map(account => (typeof account?.address === 'string' ? account.address : '')).join('|');
}

export default function TokenScreen({ open, onSend, onReceive, onSwap }) {
  const { user, getAccessToken, linkWallet, ready, authenticated } = usePrivy();
  const [portfolio, setPortfolio] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const accounts = linkedKey(user);

  useEffect(() => {
    if (!open) return undefined;
    let stopped = false;
    setLoading(true);
    (async () => {
      try {
        try {
          const { ensurePrivySessionKeys } = await import('../lib/privy-session.mjs');
          ensurePrivySessionKeys(window.localStorage, window.sessionStorage);
        } catch { /* private mode */ }
        const token = await getAccessToken();
        if (stopped) return;
        if (!token) {
          setError(portfolioErrorNote({ error: 'login_required' }));
          return;
        }
        const response = await fetch('/api/portfolio', {
          headers: {
            Authorization: `Bearer ${token}`,
            ...(user?.id ? { 'x-owner-id': user.id } : {}),
          },
          cache: 'no-store',
        });
        const body = await response.json().catch(() => ({}));
        if (stopped) return;
        if (!response.ok) {
          setPortfolio(null);
          setError(portfolioErrorNote(body));
          return;
        }
        setPortfolio(body);
        setError('');
      } catch {
        if (!stopped) setError(portfolioErrorNote({ error: 'rpc_failed' }));
      } finally {
        if (!stopped) setLoading(false);
      }
    })();
    return () => { stopped = true; };
  }, [open, accounts, getAccessToken, user?.id]);

  const holdings = combineHoldings(portfolio);
  if (selected) {
    const holding = holdings.find(row => row.mint === selected) || null;
    return (
      <TokenDetail
        mint={selected}
        holding={holding}
        cluster={portfolio?.cluster || 'mainnet'}
        onBack={() => setSelected(null)}
        onSend={() => onSend?.(holding?.symbol)}
        onReceive={onReceive}
        onSwap={() => onSwap?.(holding?.symbol)}
      />
    );
  }

  return (
    <div className="token-screen">
      <p className="wallet-figure">{formatUsdMicro(portfolio?.totalUsdMicro || '0')}</p>
      <p className="quiet">{portfolio?.note || 'Balances from QuickNode. Dollar values use mainnet prices.'}</p>
      {loading ? <p className="quiet">Reading wallets from QuickNode…</p> : null}
      {error ? <p className="quiet" role="status">{error}</p> : null}
      <ul className="token-rows">
        {holdings.map(row => (
          <li key={row.mint}>
            <button type="button" className="token-row" onClick={() => setSelected(row.mint)}>
              <span>
                <strong>{row.symbol}</strong>
                <small>{formatBaseUnits(row.amount, row.decimals)} {row.symbol}</small>
              </span>
              <b>{formatUsdMicro(row.usdMicro)}</b>
            </button>
          </li>
        ))}
      </ul>
      {holdings.length === 0 && !loading ? <p className="quiet">No priced tokens in the connected wallets yet.</p> : null}
      <div className="portfolio-actions">
        <button
          type="button"
          className="ghost"
          disabled={!ready || !authenticated}
          onClick={() => linkWallet({ walletChainType: 'solana-only' })}
        >
          Connect a wallet
        </button>
      </div>
    </div>
  );
}

function TokenDetail({ mint, holding, cluster, onBack, onSend, onReceive, onSwap }) {
  const [range, setRange] = useState('1D');
  const [view, setView] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let stopped = false;
    setError('');
    const params = new URLSearchParams({ mint, range, cluster });
    fetch(`/api/token?${params}`, { cache: 'no-store' })
      .then(response => response.json().then(body => ({ ok: response.ok, body })))
      .then(({ ok, body }) => {
        if (stopped) return;
        if (!ok) {
          setView(null);
          setError('The token chart did not load.');
          return;
        }
        setView(body);
      })
      .catch(() => {
        if (!stopped) setError('The token chart did not load.');
      });
    return () => { stopped = true; };
  }, [mint, range, cluster]);

  const symbol = view?.symbol || holding?.symbol || 'Token';
  const price = typeof view?.price === 'number' ? formatTokenPrice(view.price) : '';
  const change = typeof view?.changePct === 'number' ? view.changePct : null;
  const down = change != null && change < 0;

  return (
    <div className="token-detail">
      <button type="button" className="token-back" onClick={onBack}>Back</button>
      <div className="token-title">
        <h3>{symbol}</h3>
        {view?.trustScore == null ? <span className="token-score">—/100</span> : (
          <span className="token-score" title="Jupiter organic score">{view.trustScore}/100</span>
        )}
      </div>
      {price ? <p className="wallet-figure wallet-figure-sm">{price}</p> : null}
      {change != null ? (
        <p className={down ? 'token-down' : 'token-up'}>
          {down ? '' : '+'}{change.toFixed(2)}%
          <span> {range}</span>
        </p>
      ) : null}
      <TokenChart points={view?.points || []} range={range} />
      <div className="wallet-switch" role="group" aria-label="Chart range">
        {CHART_RANGES.map(item => (
          <button
            key={item}
            type="button"
            className={range === item ? 'is-on' : ''}
            aria-pressed={range === item}
            onClick={() => setRange(item)}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="token-position">
        <p><span>Value</span><strong>{holding ? formatUsdMicro(holding.usdMicro) : '—'}</strong></p>
        <p><span>Amount</span><strong>{holding ? `${formatBaseUnits(holding.amount, holding.decimals)} ${symbol}` : '—'}</strong></p>
      </div>
      <dl className="token-info">
        <div><dt>Name</dt><dd>{view?.name || symbol}</dd></div>
        <div><dt>Network</dt><dd>Solana</dd></div>
      </dl>
      {view?.solscanUrl ? (
        <a className="token-solscan" href={view.solscanUrl} target="_blank" rel="noreferrer">View on Solscan</a>
      ) : null}
      <div className="wallet-switch">
        <button type="button" onClick={onSend}>Send</button>
        <button type="button" onClick={onReceive}>Receive</button>
        <button type="button" onClick={onSwap}>Swap</button>
      </div>
      {error ? <p className="quiet" role="status">{error}</p> : null}
      {view?.note ? <p className="quiet">{view.note}</p> : null}
    </div>
  );
}
