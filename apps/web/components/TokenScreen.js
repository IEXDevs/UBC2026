'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { usePrivy } from '@privy-io/react-auth';
import TokenChart from './TokenChart';
import { dexTokenView, enrichPortfolio, readDexTokens } from '../lib/dex-token.mjs';
import { formatBaseUnits } from '../lib/money-views.mjs';
import { formatUsdMicro, portfolioErrorNote } from '../lib/portfolio.mjs';
import {
  CHART_RANGES,
  combineHoldings,
  formatCompactUsd,
  formatTokenPrice,
} from '../lib/token-market.mjs';
import { cachedPortfolio, rememberPortfolio } from '../lib/portfolio-cache.mjs';

function linkedKey(user) {
  const accounts = Array.isArray(user?.linkedAccounts)
    ? user.linkedAccounts
    : (Array.isArray(user?.linked_accounts) ? user.linked_accounts : []);
  return accounts.map(account => (typeof account?.address === 'string' ? account.address : '')).join('|');
}

export default function TokenScreen({ open, address = '', onSend, onReceive, onSwap, previewPortfolio = null }) {
  const { user, getAccessToken } = usePrivy();
  const [portfolio, setPortfolio] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const accounts = linkedKey(user);

  useEffect(() => {
    if (!open) return undefined;
    if (previewPortfolio) {
      setPortfolio(previewPortfolio);
      setError('');
      setLoading(false);
      return undefined;
    }
    const cacheKey = user?.id || 'portfolio';
    const cached = cachedPortfolio(cacheKey);
    if (cached) {
      setPortfolio(cached);
      setError('');
      setLoading(false);
    } else {
      setLoading(true);
    }
    let stopped = false;
    (async () => {
      try {
        const { getPrivyAccessToken } = await import('../lib/privy-session.mjs');
        const token = await getPrivyAccessToken(getAccessToken, window.localStorage);
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
        rememberPortfolio(cacheKey, body);
        setPortfolio(body);
        setError('');
        setLoading(false);
        const enriched = await enrichPortfolio(body, {
          userId: user?.id,
          storage: window.localStorage,
        });
        if (!stopped) {
          rememberPortfolio(cacheKey, enriched.portfolio);
          setPortfolio(enriched.portfolio);
        }
      } catch {
        if (!stopped) setError(portfolioErrorNote({ error: 'rpc_failed' }));
      } finally {
        if (!stopped) setLoading(false);
      }
    })();
    return () => { stopped = true; };
  }, [open, accounts, getAccessToken, user?.id, previewPortfolio]);

  const scoped = address && Array.isArray(portfolio?.wallets)
    ? { ...portfolio, wallets: portfolio.wallets.filter(row => row?.address === address) }
    : portfolio;
  const holdings = combineHoldings(scoped);
  const total = holdings.reduce((sum, row) => sum + BigInt(row.usdMicro || '0'), 0n).toString();
  const holding = selected ? holdings.find(row => row.mint === selected) || null : null;
  const ease = [0.22, 1, 0.36, 1];

  return (
    <AnimatePresence mode="wait" initial={false}>
    {selected ? (
      <motion.div
        key={selected}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        transition={{ duration: 0.45, ease }}
      >
      <TokenDetail
        mint={selected}
        holding={holding}
        cluster={portfolio?.cluster || 'devnet'}
        userId={user?.id}
        onBack={() => setSelected(null)}
        onSend={() => onSend?.(holding?.symbol)}
        onReceive={onReceive}
        onSwap={() => onSwap?.(holding?.symbol)}
      />
      </motion.div>
    ) : (
    <motion.div
      key="token-list"
      className="token-screen"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.4, ease }}
    >
      {holdings.length ? <p className="wallet-figure">{formatUsdMicro(total)}</p> : null}
      {loading ? <p className="quiet">Reading devnet balances.</p> : null}
      {error ? <p className="quiet" role="status">{error}</p> : null}
      <ul className="token-rows">
        {holdings.map(row => (
          <li key={row.mint}>
            <button type="button" className="token-row" onClick={() => setSelected(row.mint)}>
              <span>
                <strong>{row.symbol}</strong>
                <small>{formatBaseUnits(row.amount, row.decimals)} {row.symbol}</small>
              </span>
              <b>{row.usdMicro && row.usdMicro !== '0' ? formatUsdMicro(row.usdMicro) : ''}</b>
            </button>
          </li>
        ))}
      </ul>
      {holdings.length === 0 && !loading && !error ? <p className="quiet">No assets in this wallet yet.</p> : null}
    </motion.div>
    )}
    </AnimatePresence>
  );
}

function TokenDetail({ mint, holding, cluster, userId, onBack, onSend, onReceive, onSwap }) {
  const [range, setRange] = useState('1D');
  const [token, setToken] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let stopped = false;
    setError('');
    setToken(null);
    readDexTokens({ mints: [mint], userId, storage: window.localStorage })
      .then(book => {
        if (stopped) return;
        const row = book.tokens[0] || null;
        if (!row?.symbol && row?.priceUsd == null && !row?.fromCache) {
          setError(book.rateLimited
            ? 'DexScreener is limiting this network. No saved details for this token yet.'
            : 'DexScreener has no pair for this token.');
          return;
        }
        setToken(row);
      })
      .catch(() => {
        if (!stopped) setError('DexScreener did not return this token.');
      });
    return () => { stopped = true; };
  }, [mint, userId]);

  const view = token ? dexTokenView({ mint, range, cluster, token }) : null;
  const symbol = view?.symbol || holding?.symbol || 'Token';
  const price = typeof view?.price === 'number' ? formatTokenPrice(view.price) : '';
  const change = typeof view?.changePct === 'number' ? view.changePct : null;
  const down = change != null && change < 0;
  const liquidity = formatCompactUsd(view?.liquidityUsd);
  const marketCap = formatCompactUsd(view?.marketCap);
  return (
    <div className="token-detail">
      <button type="button" className="token-back" onClick={onBack}>
        <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
        Back
      </button>
      <div className="token-title">
        {view?.imageUrl ? <img className="token-mark" src={view.imageUrl} alt="" /> : null}
        <h3>{symbol}</h3>
        <span className="token-score">{view?.dexId || 'DEX'}</span>
      </div>
      {price ? <p className="wallet-figure wallet-figure-sm">{price}</p> : null}
      {change != null ? (
        <p className={down ? 'token-down' : 'token-up'}>
          {down ? '' : '+'}{change.toFixed(2)}%
          <span> {view?.changeLabel || range}</span>
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
        {liquidity ? <div><dt>Liquidity</dt><dd>{liquidity}</dd></div> : null}
        {marketCap ? <div><dt>Market cap</dt><dd>{marketCap}</dd></div> : null}
      </dl>
      {view?.pairUrl ? (
        <a className="token-solscan" href={view.pairUrl} target="_blank" rel="noreferrer">View on DexScreener</a>
      ) : null}
      {view?.solscanUrl ? (
        <a className="token-solscan" href={view.solscanUrl} target="_blank" rel="noreferrer">View on Solscan</a>
      ) : null}
      <div className="wallet-switch">
        <button type="button" onClick={onSend}>Send</button>
        <button type="button" onClick={onReceive}>Receive</button>
        <button type="button" onClick={onSwap}>Swap</button>
      </div>
      {error ? <p className="quiet" role="status">{error}</p> : null}
    </div>
  );
}
