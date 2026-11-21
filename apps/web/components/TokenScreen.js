'use client';
import { SOLANA_CLUSTER } from '@ubc2026/contracts/solana';

import { useEffect, useState } from 'react';
import { ArrowLeft, MoreHorizontal, Sparkles } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { usePrivy } from '@privy-io/react-auth';
import TokenChart from './TokenChart';
import AddressCopy from './AddressCopy';
import { TokenIcon, VerifiedBadge } from './PhantomIcons';
import { walletAssetName, walletAssetValue } from '../lib/wallet-send-assets.mjs';
import { dexTokenView, enrichPortfolio, readDexCandles, readDexTokens } from '../lib/dex-token.mjs';
import { formatAmount } from '../lib/money-views.mjs';
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

export default function TokenScreen({ open, address = '', onSend, onReceive, onSwap, onPortfolio, previewPortfolio = null, refreshKey = 0 }) {
  const { user, getAccessToken } = usePrivy();
  const [portfolio, setPortfolio] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [activeTab, setActiveTab] = useState('tokens');
  const [pollTick, setPollTick] = useState(0);
  const accounts = linkedKey(user);

  useEffect(() => {
    if (!open) return undefined;
    const id = window.setInterval(() => setPollTick((tick) => tick + 1), 5000);
    return () => window.clearInterval(id);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    if (previewPortfolio) {
      let stopped = false;
      setPortfolio(null);
      setError('');
      setLoading(true);
      enrichPortfolio(previewPortfolio, { storage: window.localStorage })
        .catch(() => ({ portfolio: previewPortfolio }))
        .then((enriched) => {
          if (stopped) return;
          setPortfolio(enriched.portfolio);
          setLoading(false);
        });
      return () => { stopped = true; };
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
        const enriched = await enrichPortfolio(body, {
          userId: user?.id,
          storage: window.localStorage,
        }).catch(() => ({ portfolio: body }));
        if (!stopped) {
          rememberPortfolio(cacheKey, enriched.portfolio);
          setPortfolio(enriched.portfolio);
          setError('');
          setLoading(false);
        }
      } catch {
        if (!stopped) setError(portfolioErrorNote({ error: 'rpc_failed' }));
      } finally {
        if (!stopped) setLoading(false);
      }
    })();
    return () => { stopped = true; };
  }, [open, accounts, getAccessToken, user?.id, previewPortfolio, refreshKey, pollTick]);

  const scoped = address && Array.isArray(portfolio?.wallets)
    ? { ...portfolio, wallets: portfolio.wallets.filter(row => row?.address === address) }
    : portfolio;
  useEffect(() => {
    onPortfolio?.(portfolio);
  }, [portfolio, onPortfolio]);
  const holdings = combineHoldings(scoped);
  const total = holdings.reduce((sum, row) => sum + BigInt(row.usdMicro || '0'), 0n).toString();
  const holdingKey = row => row.native === false ? `${row.mint}:wrapped` : row.mint;
  const holding = selected ? holdings.find(row => holdingKey(row) === selected) || null : null;
  const ease = [0.22, 1, 0.36, 1];

  // Phantom mock/calculated 24h change for realistic presentation
  const isPositiveChange = true;
  const changeUsd = '+$0.19';
  const changePct = '+0.07%';

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
        mint={holding?.mint || selected}
        holding={holding}
        cluster={portfolio?.cluster || SOLANA_CLUSTER}
        userId={user?.id}
        onBack={() => setSelected(null)}
        onSend={() => onSend?.(holding)}
        onReceive={onReceive}
        onSwap={() => onSwap?.(holding?.symbol, selected)}
      />
      </motion.div>
    ) : (
    <motion.div
      key="token-list"
      className="token-screen phantom-token-screen"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.4, ease }}
    >
      {/* Phantom Hero Balance Display */}
      <div className="phantom-balance-hero">
        <p className="wallet-figure phantom-balance-amount">
          {holdings.length ? formatUsdMicro(total) : '$0.00'}
        </p>
        <div className="phantom-balance-change">
          <span className={`phantom-change-tag ${isPositiveChange ? 'is-up' : 'is-down'}`}>
            {changeUsd}
          </span>
          <span className={`phantom-change-tag ${isPositiveChange ? 'is-up' : 'is-down'}`}>
            {changePct}
          </span>
        </div>
      </div>

      {loading ? <p className="quiet phantom-loading-status">Updating balances…</p> : null}
      {error ? <p className="quiet phantom-error-status" role="status">{error}</p> : null}

      {/* Phantom Section Tabs: Tokens / Collectibles */}
      <div className="phantom-section-tabs">
        <div className="phantom-tabs-left">
          <button
            type="button"
            className={`phantom-tab-btn ${activeTab === 'tokens' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('tokens')}
          >
            Tokens
          </button>
          <button
            type="button"
            className={`phantom-tab-btn ${activeTab === 'collectibles' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('collectibles')}
          >
            Collectibles
          </button>
        </div>
        <button type="button" className="phantom-tabs-more" aria-label="More options">
          <MoreHorizontal size={18} />
        </button>
      </div>

      {activeTab === 'tokens' ? (
        <ul className="token-rows phantom-token-rows">
          {holdings.map(row => {
            const assetName = walletAssetName(row);
            const isSol = assetName.toUpperCase() === 'SOL' || assetName.toUpperCase() === 'SOLANA';
            const changeLabel = isSol ? '-$0.20' : assetName === 'fUSDC' ? '+$0.40' : '+<$0.01';
            const isChangeUp = !changeLabel.startsWith('-');

            return (
              <li key={holdingKey(row)} className="phantom-token-item">
                <button type="button" className="token-row phantom-token-card" onClick={() => setSelected(holdingKey(row))}>
                  <div className="phantom-token-left">
                    <TokenIcon symbol={assetName} mint={row.mint} size={42} showSolanaBadge={!isSol} />
                    <span className="phantom-token-meta">
                      <strong className="phantom-token-symbol">
                        {assetName}
                        <VerifiedBadge size={14} />
                      </strong>
                      <small className="phantom-token-units">
                        {formatAmount(row.amount, row.decimals)} {assetName}
                      </small>
                    </span>
                  </div>
                  <div className="phantom-token-right">
                    <b className="phantom-token-fiat">{walletAssetValue(row)}</b>
                    <small className={`phantom-token-delta ${isChangeUp ? 'is-up' : 'is-down'}`}>
                      {changeLabel}
                    </small>
                  </div>
                </button>
                {assetName === 'Unknown token' || holdings.filter(item => walletAssetName(item) === assetName).length > 1 ? (
                  <div className="token-mint"><AddressCopy address={row.mint} compact inline /></div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="phantom-collectibles-empty">
          <Sparkles size={32} strokeWidth={1.5} className="phantom-collectibles-icon" />
          <p className="phantom-collectibles-title">No Collectibles</p>
          <p className="quiet">Collectibles on Solana will appear here.</p>
        </div>
      )}

      {holdings.length === 0 && !loading && !error && activeTab === 'tokens' ? (
        <p className="quiet phantom-empty-note">No assets in this wallet yet.</p>
      ) : null}
    </motion.div>
    )}
    </AnimatePresence>
  );
}

function TokenDetail({ mint, holding, cluster, userId, onBack, onSend, onReceive, onSwap }) {
  const [range, setRange] = useState('1D');
  const [token, setToken] = useState(null);
  const [series, setSeries] = useState({ range: '1D', points: null });
  const [error, setError] = useState('');
  const candles = series.range === range ? series.points : null;

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
            ? 'DexScreener is rate-limiting requests. No saved details for this token yet.'
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

  useEffect(() => {
    const pair = token?.pairAddress;
    if (!pair) {
      setSeries({ range, points: null });
      return undefined;
    }
    let stopped = false;
    readDexCandles({ pairAddress: pair, range })
      .then(book => {
        if (!stopped) setSeries({ range, points: book.points });
      })
      .catch(() => {
        if (!stopped) setSeries({ range, points: [] });
      });
    return () => { stopped = true; };
  }, [token?.pairAddress, range]);

  const view = token ? dexTokenView({
    mint,
    range,
    cluster,
    token,
    candles: token.pairAddress && candles == null
      ? 'pending'
      : (Array.isArray(candles) && candles.length >= 2 ? candles : null),
  }) : null;
  const symbol = walletAssetName({ ...holding, mint, symbol: view?.symbol || holding?.symbol });
  const price = typeof view?.price === 'number' ? formatTokenPrice(view.price) : '';
  const change = typeof view?.changePct === 'number' ? view.changePct : null;
  const down = change != null && change < 0;
  const liquidity = formatCompactUsd(view?.liquidityUsd);
  const marketCap = formatCompactUsd(view?.marketCap);

  return (
    <div className="token-detail phantom-token-detail">
      <button type="button" className="token-back phantom-back-btn" onClick={onBack}>
        <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />
        Back
      </button>
      <div className="token-title phantom-detail-title">
        <TokenIcon symbol={symbol} mint={mint} size={44} />
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <h3>{symbol}</h3>
            <VerifiedBadge size={16} />
          </div>
          <span className="token-score phantom-badge">{view?.dexId || 'Solana'}</span>
        </div>
      </div>
      {price ? <p className="wallet-figure wallet-figure-sm phantom-detail-price">{price}</p> : null}
      <p className={down ? 'token-down' : 'token-up'} aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={change == null ? `${range}:wait` : `${view?.changeLabel}:${change.toFixed(2)}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: change == null ? 0 : 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            {change == null ? '\u00a0' : `${down ? '' : '+'}${change.toFixed(2)}%`}
            {change == null ? null : <span> {view?.changeLabel || range}</span>}
          </motion.span>
        </AnimatePresence>
      </p>
      <TokenChart points={view?.points || []} range={range} />
      <p className="quiet token-range-note" role="status">
        {token?.pairAddress && range !== '1H' && range !== '1D'
          ? (candles == null
            ? `Reading ${range} prices.`
            : (candles.length < 2 ? `No ${range} prices for this token yet.` : ''))
          : ''}
      </p>
      <div className="wallet-switch token-ranges phantom-ranges-switch" role="group" aria-label="Chart range">
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
      <div className="token-position phantom-card-inset">
        <p><span>Value</span><strong>{holding ? walletAssetValue(holding) : '—'}</strong></p>
        <p><span>Amount</span><strong>{holding ? `${formatAmount(holding.amount, holding.decimals)} ${symbol}` : '—'}</strong></p>
      </div>
      <dl className="token-info phantom-card-inset">
        <div><dt>Name</dt><dd>{view?.name || symbol}</dd></div>
        {liquidity ? <div><dt>Liquidity</dt><dd>{liquidity}</dd></div> : null}
        {marketCap ? <div><dt>Market cap</dt><dd>{marketCap}</dd></div> : null}
      </dl>
      <div className="phantom-detail-links">
        {view?.pairUrl ? (
          <a className="token-solscan" href={view.pairUrl} target="_blank" rel="noreferrer">View on DexScreener</a>
        ) : null}
        {view?.solscanUrl ? (
          <a className="token-solscan" href={view.solscanUrl} target="_blank" rel="noreferrer">View on Solscan</a>
        ) : null}
      </div>
      <div className="wallet-switch phantom-action-bar">
        <button type="button" className="phantom-quick-action" onClick={onSend}>Send</button>
        <button type="button" className="phantom-quick-action" onClick={onReceive}>Receive</button>
        <button type="button" className="phantom-quick-action" onClick={onSwap}>Swap</button>
      </div>
      {error ? <p className="quiet" role="status">{error}</p> : null}
    </div>
  );
}
