'use client';

import { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { X } from 'lucide-react';
import BotHistory from './BotHistory';
import AddressCopy from './AddressCopy';
import PortfolioGraph from './PortfolioGraph';
import PrivyKeyButton from './PrivyKeyButton';
import TokenScreen from './TokenScreen';
import SlideCommit from './bits/SlideCommit';
import TxnLog from './TxnLog';
import TxnPreview from './TxnPreview';
import { usePresence } from './usePresence';
import { partyFromToken } from '../lib/party-book.mjs';
import { portfolioErrorNote } from '../lib/portfolio.mjs';
import { describeWallets, formatBaseUnits, walletGlance } from '../lib/money-views.mjs';
import {
  deskTokens,
  displayToUnits,
  emptyTokenPrefs,
  normalizeTokenPrefs,
  parseSendTarget,
  readQuoteOut,
  swapQuoteUrl,
  tokenStorageKey,
  tradeableTokens,
} from '../lib/wallet-desk.mjs';
import { sendPreview, swapPreview } from '../lib/txn-preview.mjs';

const PANES = [
  { id: 'assets', label: 'Assets' },
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'send', label: 'Send' },
  { id: 'receive', label: 'Receive' },
  { id: 'swap', label: 'Swap' },
  { id: 'tokens', label: 'Tokens' },
  { id: 'history', label: 'History' },
  { id: 'keys', label: 'Keys' },
];

export default function WalletsSheet({
  open,
  onClose,
  state,
  note = '',
  transfers = [],
  bot = null,
  onParty,
  signedIn = false,
  ownerId = '',
  handle = '',
  sns = '',
  onSend,
  onReceipt,
}) {
  const { mounted, leaving } = usePresence(open);
  const [pane, setPane] = useState('assets');
  const [walletId, setWalletId] = useState('');
  const [prefs, setPrefs] = useState(emptyTokenPrefs);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) setPane('assets');
  }, [open]);

  useEffect(() => {
    const key = tokenStorageKey(ownerId);
    if (!key) {
      setPrefs(emptyTokenPrefs());
      return;
    }
    try {
      const raw = localStorage.getItem(key);
      setPrefs(normalizeTokenPrefs(raw ? JSON.parse(raw) : null));
    } catch {
      setPrefs(emptyTokenPrefs());
    }
  }, [ownerId, open]);

  function savePrefs(next) {
    const clean = normalizeTokenPrefs(next);
    setPrefs(clean);
    const key = tokenStorageKey(ownerId);
    if (key) localStorage.setItem(key, JSON.stringify(clean));
  }

  if (!mounted) return null;

  const wallets = state?.wallets || [];
  const bots = state?.bots || [];
  const positions = state?.positions || [];
  const glance = walletGlance(wallets, positions, transfers);
  const rows = describeWallets(wallets, bots);
  const active = rows.find(row => row.id === walletId) || rows[0] || null;
  const activeRaw = wallets.find(wallet => wallet.id === active?.id) || null;
  const observing = activeRaw?.spendable === false;
  const tokens = deskTokens({ positions, transfers, prefs: { ...prefs, sns: prefs.sns || sns || '' } });

  return (
    <div className={`backdrop is-center ${leaving ? 'is-leaving' : ''}`} onMouseDown={onClose}>
      <section
        className="sheet wallets-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallets-title"
        onMouseDown={event => event.stopPropagation()}
      >
        <nav className="wallet-nav" aria-label="Wallet sections">
          <strong id="wallets-title">Wallet</strong>
          {PANES.map(item => (
            <button
              key={item.id}
              type="button"
              className={pane === item.id ? 'is-on' : ''}
              aria-current={pane === item.id ? 'page' : undefined}
              onClick={() => setPane(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="wallet-body">
          <div className="sheet-head">
            <h2>{PANES.find(item => item.id === pane)?.label}</h2>
            <button type="button" className="icon-btn" aria-label="Close wallets" onClick={onClose}>
              <X size={18} strokeWidth={1.75} />
            </button>
          </div>
          {rows.length > 1 ? (
            <div className="wallet-switch" role="tablist" aria-label="Wallets">
              {rows.map(row => (
                <button
                  key={row.id}
                  type="button"
                  role="tab"
                  aria-selected={active?.id === row.id}
                  className={active?.id === row.id ? 'is-on' : ''}
                  onClick={() => setWalletId(row.id)}
                >
                  {row.label}
                </button>
              ))}
            </div>
          ) : null}
          {pane === 'assets' ? (
            <>
              {note ? <p className="quiet">{note}</p> : null}
              {signedIn ? (
                <TokenScreen
                  open={open}
                  onSend={() => setPane('send')}
                  onReceive={() => setPane('receive')}
                  onSwap={() => setPane('swap')}
                />
              ) : <p className="quiet">Sign in to see tokens, the chart, and send or receive.</p>}
            </>
          ) : null}
          {pane === 'portfolio' ? (
            signedIn ? <ConnectedPortfolio open={open} /> : <p className="quiet">Sign in to connect wallets and read balances.</p>
          ) : null}
          {pane === 'send' ? (
            <SendPane
              active={active}
              tokens={tradeableTokens(tokens)}
              frozen={Boolean(active?.frozen)}
              observing={observing}
              onSend={onSend}
              onReceipt={onReceipt}
            />
          ) : null}
          {pane === 'receive' ? (
            <ReceivePane active={active} handle={handle} sns={prefs.sns} onSns={value => savePrefs({ ...prefs, sns: value })} />
          ) : null}
          {pane === 'swap' ? <SwapPane tokens={tradeableTokens(tokens)} onReceipt={onReceipt} /> : null}
          {pane === 'tokens' ? <TokenPane tokens={tokens} prefs={prefs} onSave={savePrefs} /> : null}
          {pane === 'history' ? (
            bot ? (
              <BotHistory bot={bot} bots={bots} payments={state?.payments || []} transfers={transfers} onParty={onParty} />
            ) : (
              <TxnLog
                rows={transfers.map(row => {
                  const direction = row.direction === 'in' ? 'in' : 'out';
                  return {
                    id: row.id,
                    direction,
                    title: `${direction === 'in' ? 'From' : 'To'} @${row.handle}`,
                    detail: 'Platform',
                    amount: row.amount,
                    asset: 'USDC',
                    party: partyFromToken(`@${row.handle}`),
                  };
                })}
                onParty={onParty}
                empty="No history yet."
              />
            )
          ) : null}
          {pane === 'keys' ? (
            <div className="wallet-keys">
              <p>The private key stays in Privy. This screen never reads it, stores it, or shows it.</p>
              <PrivyKeyButton signedIn={signedIn} address={active?.address || glance.address} />
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function linkedKey(user) {
  const accounts = Array.isArray(user?.linkedAccounts)
    ? user.linkedAccounts
    : (Array.isArray(user?.linked_accounts) ? user.linked_accounts : []);
  return accounts.map(account => (typeof account?.address === 'string' ? account.address : '')).join('|');
}

function ConnectedPortfolio({ open }) {
  const { user, getAccessToken, linkWallet, unlinkWallet, ready, authenticated } = usePrivy();
  const [portfolio, setPortfolio] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [removing, setRemoving] = useState('');
  const accounts = linkedKey(user);

  useEffect(() => {
    if (!open) return undefined;
    let stopped = false;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const { getPrivyAccessToken } = await import('../lib/privy-session.mjs');
        const token = await getPrivyAccessToken(getAccessToken, window.localStorage);
        if (stopped) return;
        if (!token) {
          setPortfolio(null);
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
      } catch {
        if (!stopped) {
          setPortfolio(null);
          setError(portfolioErrorNote({ error: 'rpc_failed' }));
        }
      } finally {
        if (!stopped) setLoading(false);
      }
    })();
    return () => { stopped = true; };
  }, [open, accounts, getAccessToken, user?.id]);

  async function remove(address) {
    setRemoving(address);
    setError('');
    try {
      await unlinkWallet(address);
    } catch {
      setError('Could not remove that wallet.');
    } finally {
      setRemoving('');
    }
  }

  return (
    <PortfolioGraph
      portfolio={portfolio}
      error={error}
      loading={loading}
      removing={removing}
      onConnect={() => {
        if (ready && authenticated) linkWallet({ walletChainType: 'solana-only' });
      }}
      onRemove={remove}
    />
  );
}

function SendPane({ active, tokens, frozen, observing = false, onSend, onReceipt }) {
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [symbol, setSymbol] = useState('USDC');
  const [status, setStatus] = useState('');
  const [resetKey, setResetKey] = useState(0);
  const [folded, setFolded] = useState(false);
  const asset = tokens.find(token => token.symbol === symbol) || tokens[0] || null;
  const target = parseSendTarget(to);
  const units = asset ? displayToUnits(amount, asset.decimals) : null;
  const [snsAddress, setSnsAddress] = useState('');
  const [snsFailed, setSnsFailed] = useState(false);
  useEffect(() => {
    if (target?.kind !== 'sns') {
      setSnsAddress('');
      setSnsFailed(false);
      return undefined;
    }
    let stop = false;
    setSnsAddress('');
    setSnsFailed(false);
    const domain = target.domain;
    fetch(`/api/sns/resolve?domain=${encodeURIComponent(domain)}`, { cache: 'no-store' })
      .then(response => response.json().then(body => ({ ok: response.ok, body })))
      .then(({ ok, body }) => {
        if (stop) return;
        if (ok && typeof body.address === 'string' && body.address) setSnsAddress(body.address);
        else setSnsFailed(true);
      })
      .catch(() => { if (!stop) setSnsFailed(true); });
    return () => { stop = true; };
  }, [target?.kind, target?.domain]);
  const ready = Boolean(
    active && !frozen && !observing && target && target.kind !== 'address' && units && asset?.symbol === 'USDC'
    && (target.kind !== 'sns' || snsAddress),
  );
  const destination = target?.kind === 'handle'
    ? `@${target.handle}`
    : target?.kind === 'sns'
      ? (snsAddress || target.domain)
      : '';
  const preview = ready ? sendPreview({
    from: active?.label || 'Agent wallet',
    to: destination,
    amountLabel: `${amount.trim()} ${asset.symbol}`,
  }) : null;

  return (
    <form className="wallet-form field" onSubmit={event => event.preventDefault()}>
      <p className="quiet">{active ? `From ${active.label}` : 'No wallet yet.'} A slide confirms the send. Nothing is signed before that.</p>
      {observing ? <p className="quiet" role="status">This connected wallet is read-only. Platform sends use your agent wallet.</p> : null}
      {frozen ? <p className="quiet" role="status">This wallet is frozen.</p> : null}
      <label>
        To
        <input
          value={to}
          placeholder="@alex or name.sol"
          autoCapitalize="none"
          spellCheck={false}
          onChange={event => { setTo(event.target.value); setStatus(''); setFolded(false); }}
        />
      </label>
      {target?.kind === 'sns' && snsFailed ? (
        <p className="quiet" role="status">Failed.</p>
      ) : target?.kind === 'sns' && snsAddress ? (
        <AddressCopy address={snsAddress} prefix={target.domain} />
      ) : (
        <p className="quiet">{targetHint(target)}</p>
      )}
      <label>
        Amount
        <input
          value={amount}
          inputMode="decimal"
          placeholder="0.00"
          onChange={event => { setAmount(event.target.value); setStatus(''); setFolded(false); }}
        />
      </label>
      <div className="wallet-switch" role="group" aria-label="Asset">
        {tokens.map(token => (
          <button
            key={token.symbol}
            type="button"
            className={asset?.symbol === token.symbol ? 'is-on' : ''}
            aria-pressed={asset?.symbol === token.symbol}
            onClick={() => { setSymbol(token.symbol); setStatus(''); setFolded(false); }}
          >
            {token.symbol}
          </button>
        ))}
      </div>
      {asset && asset.symbol !== 'USDC' ? (
        <p className="quiet">Platform sends are USDC. Other assets wait for the swap executor.</p>
      ) : null}
      <TxnPreview preview={preview} folded={folded} onToggle={() => setFolded(false)} />
      <SlideCommit
        label="Slide to send"
        doneLabel="Sending"
        disabled={!ready}
        resetKey={`${resetKey}:${to}:${amount}:${asset?.symbol || ''}`}
        onCommit={() => {
          const pending = { target, amount: units, asset: asset.symbol };
          Promise.resolve(onSend?.(pending)).then(result => {
            setStatus(result?.message || result?.error || 'The send did not post.');
            if (result?.ok) {
              setFolded(true);
              if (result.receipt) onReceipt?.(result.receipt);
            }
            if (!result?.ok) setResetKey(value => value + 1);
          }).catch(() => {
            setStatus('The send did not post.');
            setResetKey(value => value + 1);
          });
        }}
      />
      {status ? <p className="quiet" role="status">{status}</p> : null}
    </form>
  );
}

function targetHint(target) {
  if (!target) return 'Use a Maelstrom @handle or a .sol name.';
  if (target.kind === 'handle') return `Sends USDC to @${target.handle} on the platform ledger.`;
  if (target.kind === 'sns') return `Looking up ${target.domain}.`;
  return 'Raw addresses are not on the platform ledger yet.';
}

function ReceivePane({ active, handle, sns, onSns }) {
  const [draft, setDraft] = useState(sns || '');
  const [note, setNote] = useState('');
  useEffect(() => { setDraft(sns || ''); }, [sns]);

  return (
    <div className="wallet-form">
      <p className="quiet">Share the address, or your @handle. A .sol name is read from SNS when someone sends to it.</p>
      {handle ? <p className="wallet-handle">@{handle}</p> : <p className="quiet">Claim a @handle to get paid by name.</p>}
      <AddressCopy address={active?.address || ''} />
      {sns ? <p className="wallet-handle">{sns}</p> : null}
      <form
        className="field"
        onSubmit={(event) => {
          event.preventDefault();
          const next = normalizeTokenPrefs({ sns: draft }).sns;
          if (draft.trim() && !next) {
            setNote('Use a name like richclub.sol.');
            return;
          }
          setNote(next ? `Showing ${next}.` : 'Cleared.');
          onSns?.(draft);
        }}
      >
        <label>
          SNS name
          <input
            value={draft}
            placeholder="name.sol"
            autoCapitalize="none"
            spellCheck={false}
            onChange={event => setDraft(event.target.value.replace(/^@/, ''))}
          />
        </label>
        <button type="submit" className="ghost">Save name</button>
      </form>
      {note ? <p className="quiet" role="status">{note}</p> : null}
    </div>
  );
}

function SwapPane({ tokens, onReceipt }) {
  const [from, setFrom] = useState(tokens[0]?.symbol || 'USDC');
  const [to, setTo] = useState(tokens[1]?.symbol || 'SOL');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState('');
  const [quote, setQuote] = useState('');
  const [resetKey, setResetKey] = useState(0);
  const [folded, setFolded] = useState(false);
  const input = tokens.find(token => token.symbol === from) || null;
  const output = tokens.find(token => token.symbol === to) || null;
  const units = input ? displayToUnits(amount, input.decimals) : null;
  const ready = Boolean(units && input && output && input.symbol !== output.symbol);
  const receive = quote && output ? quote.replace(new RegExp(` ${output.symbol}$`), '') : '';
  const preview = ready ? swapPreview({
    pay: amount.trim(),
    receive,
    from: input.symbol,
    to: output.symbol,
  }) : null;

  async function loadQuote() {
    setQuote('');
    const built = swapQuoteUrl('jupiter', tokens, {
      inputSymbol: input?.symbol,
      outputSymbol: output?.symbol,
      amount: units,
    });
    if (!built.url) {
      setStatus(built.error === 'not_tradeable'
        ? 'That token is restricted.'
        : 'Choose two different tradeable tokens and an amount.');
      return;
    }
    const url = built.url;
    setStatus('Quoting…');
    try {
      const response = await fetch(url);
      const body = await response.json().catch(() => ({}));
      const out = readQuoteOut(body);
      if (!response.ok || !out) {
        setStatus('No quote. Nothing was signed.');
        return;
      }
      const shown = formatBaseUnits(out, output.decimals);
      const next = swapPreview({
        pay: amount.trim(),
        receive: shown,
        from: input.symbol,
        to: output.symbol,
      });
      setQuote(`${shown} ${output.symbol}`);
      setFolded(true);
      onReceipt?.({
        id: `quote_${input.symbol}_${output.symbol}_${units}_${shown}`,
        at: new Date().toISOString(),
        title: next.title,
        lines: next.lines,
        cluster: 'devnet',
      });
      setStatus('Jupiter quote. devnet execution, mainnet pricing. Nothing was signed.');
    } catch {
      setStatus('The quote did not load. Nothing was signed.');
    }
  }

  return (
    <div className="wallet-form field">
      <p className="quiet">Jupiter aggregates the Solana routes. A slide confirms the quote. Nothing is signed before that.</p>
      <div className="wallet-switch" role="group" aria-label="From token">
        {tokens.map(token => (
          <button key={token.symbol} type="button" className={from === token.symbol ? 'is-on' : ''} aria-pressed={from === token.symbol} onClick={() => { setFrom(token.symbol); setFolded(false); }}>
            {token.symbol}
          </button>
        ))}
      </div>
      <div className="wallet-switch" role="group" aria-label="To token">
        {tokens.map(token => (
          <button key={`to-${token.symbol}`} type="button" className={to === token.symbol ? 'is-on' : ''} aria-pressed={to === token.symbol} onClick={() => { setTo(token.symbol); setFolded(false); }}>
            {token.symbol}
          </button>
        ))}
      </div>
      <label>
        Amount
        <input value={amount} inputMode="decimal" placeholder="0.00" onChange={event => { setAmount(event.target.value); setQuote(''); setFolded(false); }} />
      </label>
      <TxnPreview preview={preview} folded={folded} onToggle={() => setFolded(false)} />
      <SlideCommit
        label="Slide to swap"
        doneLabel="Quoting"
        disabled={!ready}
        resetKey={`${resetKey}:${from}:${to}:${amount}`}
        onCommit={() => {
          loadQuote().finally(() => setResetKey(value => value + 1));
        }}
      />
      {quote ? <p className="wallet-figure wallet-figure-sm">{quote}</p> : null}
      {status ? <p className="quiet" role="status">{status}</p> : null}
    </div>
  );
}

function TokenPane({ tokens, prefs, onSave }) {
  const [symbol, setSymbol] = useState('');
  const [mint, setMint] = useState('');
  const [decimals, setDecimals] = useState('6');
  const [note, setNote] = useState('');

  function toggle(list, value) {
    return list.includes(value) ? list.filter(item => item !== value) : [...list, value];
  }

  return (
    <div className="wallet-form">
      <p className="quiet">Hidden tokens leave the asset list. Restricted tokens stay visible and cannot be sent or swapped here. USDC stays on both.</p>
      <ul className="token-rows">
        {tokens.map(token => (
          <li key={token.symbol} className="token-settings">
            <strong>{token.symbol}</strong>
            <span>{token.amountLabel}</span>
            {token.symbol === 'USDC' ? <small>Always listed</small> : (
              <span className="wallet-switch">
                <button
                  type="button"
                  className={token.hidden ? 'is-on' : ''}
                  aria-pressed={token.hidden}
                  onClick={() => onSave({ ...prefs, hidden: toggle(prefs.hidden, token.symbol) })}
                >
                  {token.hidden ? 'Hidden' : 'Hide'}
                </button>
                <button
                  type="button"
                  className={!token.tradeable ? 'is-on' : ''}
                  aria-pressed={!token.tradeable}
                  onClick={() => onSave({ ...prefs, restricted: toggle(prefs.restricted, token.symbol) })}
                >
                  {token.tradeable ? 'Tradeable' : 'Restricted'}
                </button>
                {token.core ? null : (
                  <button
                    type="button"
                    onClick={() => onSave({ ...prefs, extra: prefs.extra.filter(row => row.symbol !== token.symbol) })}
                  >
                    Remove
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
      <form
        className="field"
        onSubmit={(event) => {
          event.preventDefault();
          const next = normalizeTokenPrefs({
            ...prefs,
            extra: [...prefs.extra, { symbol, mint, decimals: Number(decimals) }],
          });
          if (next.extra.length === prefs.extra.length) {
            setNote('Use a new symbol, a Solana mint, and decimals from 0 to 9.');
            return;
          }
          onSave(next);
          setSymbol('');
          setMint('');
          setDecimals('6');
          setNote('Added.');
        }}
      >
        <label>
          Symbol
          <input value={symbol} maxLength={12} autoCapitalize="characters" onChange={event => setSymbol(event.target.value)} />
        </label>
        <label>
          Mint
          <input value={mint} spellCheck={false} autoCapitalize="none" onChange={event => setMint(event.target.value.trim())} />
        </label>
        <label>
          Decimals
          <input value={decimals} inputMode="numeric" onChange={event => setDecimals(event.target.value)} />
        </label>
        <button type="submit" className="ghost">Add token</button>
      </form>
      {note ? <p className="quiet" role="status">{note}</p> : null}
    </div>
  );
}
