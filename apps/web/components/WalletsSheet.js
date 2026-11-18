'use client';

import { useEffect, useState } from 'react';
import { useImportSeedPhrase, usePrivy } from '@privy-io/react-auth';
import { useCreateWallet, useImportWallet } from '@privy-io/react-auth/solana';
import { X } from 'lucide-react';
import BotHistory from './BotHistory';
import AddressCopy from './AddressCopy';
import PortfolioGraph from './PortfolioGraph';
import PrivyKeyButton from './PrivyKeyButton';
import TokenScreen from './TokenScreen';
import SlideCommit from './bits/SlideCommit';
import Spotlight from './bits/Spotlight';
import TxnLog from './TxnLog';
import SendToField from './SendToField';
import TxnPreview from './TxnPreview';
import { usePresence } from './usePresence';
import { DEV_PREVIEW_OWNER, samplePortfolio } from '../lib/dev-preview.mjs';
import { enrichPortfolio } from '../lib/dex-token.mjs';
import { partyFromToken } from '../lib/party-book.mjs';
import { portfolioErrorNote } from '../lib/portfolio.mjs';
import { describeWallets, formatBaseUnits, sendDestinations, walletGlance } from '../lib/money-views.mjs';
import {
  deskTokens,
  displayToUnits,
  emptyTokenPrefs,
  normalizeTokenPrefs,
  parseImportKey,
  parseSendTarget,
  readQuoteOut,
  swapDraft,
  verifyRecoveryPhrase,
  tokenStorageKey,
  tradeableTokens,
} from '../lib/wallet-desk.mjs';
import { sendHandleHint, sendHandleReady } from '../lib/profile.mjs';
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
  devPreview = false,
  ownerId = '',
  handle = '',
  sns = '',
  onSend,
  onReceipt,
  focusId = '',
  getAccessToken,
  resolveRecipient = null,
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
    if (open && focusId) setWalletId(focusId);
  }, [open, focusId]);

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
          <WalletSwitcher rows={rows} activeId={active?.id || ''} onSelect={setWalletId} />
          {signedIn ? <WalletAdd /> : null}
          {pane === 'assets' ? (
            <>
              {note ? <p className="quiet">{note}</p> : null}
              {signedIn ? (
                <TokenScreen
                  open={open}
                  preview={devPreview}
                  onSend={() => setPane('send')}
                  onReceive={() => setPane('receive')}
                  onSwap={() => setPane('swap')}
                />
              ) : <p className="quiet">Sign in to see tokens, the chart, and send or receive.</p>}
            </>
          ) : null}
          {pane === 'portfolio' ? (
            signedIn ? <ConnectedPortfolio open={open} preview={devPreview} /> : <p className="quiet">Sign in to connect wallets and read balances.</p>
          ) : null}
          {pane === 'send' ? (
            <SendPane
              active={active}
              destinations={sendDestinations(wallets, bots, active?.id || '')}
              tokens={tradeableTokens(tokens)}
              frozen={Boolean(active?.frozen)}
              observing={observing}
              onSend={onSend}
              onReceipt={onReceipt}
              resolveRecipient={resolveRecipient}
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
              <p>The key stays encrypted until this browser decrypts the download. Maelstrom does not store it.</p>
              <PrivyKeyButton
                signedIn={signedIn}
                address={active?.address || glance.address}
                walletId={activeRaw?.privyWalletId || ''}
                ownerId={ownerId}
                getAccessToken={getAccessToken}
              />
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

function ConnectedPortfolio({ open, preview = false }) {
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
    if (preview) {
      (async () => {
        try {
          const enriched = await enrichPortfolio(samplePortfolio(), {
            userId: DEV_PREVIEW_OWNER,
            storage: window.localStorage,
          });
          if (!stopped) setPortfolio({ ...enriched.portfolio, note: samplePortfolio().note });
        } catch {
          if (!stopped) setError('DexScreener did not price the preview.');
        } finally {
          if (!stopped) setLoading(false);
        }
      })();
      return () => { stopped = true; };
    }
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
        const enriched = await enrichPortfolio(body, {
          userId: user?.id,
          storage: window.localStorage,
        });
        if (!stopped) setPortfolio(enriched.portfolio);
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
  }, [open, preview, accounts, getAccessToken, user?.id]);

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

function WalletAdd() {
  const { createWallet } = useCreateWallet();
  const { importWallet } = useImportWallet();
  const { importSeedPhrase } = useImportSeedPhrase();
  const [mode, setMode] = useState('');
  const [seed, setSeed] = useState('');
  const [privkey, setPrivkey] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  function finish(message) {
    setSeed('');
    setPrivkey('');
    setBusy(false);
    setNote(message);
  }

  return (
    <div className="wallet-add">
      <div className="wallet-switch" role="group" aria-label="Add a wallet">
        <button type="button" disabled={busy} onClick={() => {
          setBusy(true);
          setNote('');
          createWallet()
            .then(() => finish('New wallet created. Maelstrom does not store its key.'))
            .catch(() => finish('That wallet was not created. Import a seed or a private key, or connect another wallet.'));
        }}>Generate</button>
        <button type="button" disabled={busy} aria-pressed={mode === 'seed'} onClick={() => { setMode('seed'); setPrivkey(''); setNote(''); }}>Import seed</button>
        <button type="button" disabled={busy} aria-pressed={mode === 'key'} onClick={() => { setMode('key'); setSeed(''); setNote(''); }}>Import key</button>
      </div>
      <p className="quiet">The phrase and the private key are not stored here. If you do not keep your own copy, it is gone.</p>
      {mode === 'seed' ? (
        <form className="field" onSubmit={(event) => {
          event.preventDefault();
          const words = seed.trim().toLowerCase().split(/\s+/);
          setBusy(true);
          verifyRecoveryPhrase(words).then(valid => {
            if (!valid) {
              setBusy(false);
              setNote('Type a 12-word seed phrase.');
              return null;
            }
            return importSeedPhrase({ mnemonic: words.join(' '), chainType: 'solana' })
              .then(() => finish('Seed imported. The field is cleared. Maelstrom does not keep the phrase.'));
          }).catch(() => finish('That seed was not imported.'));
        }}>
          <label>
            Seed phrase
            <textarea value={seed} rows={3} spellCheck={false} autoCapitalize="none" autoComplete="off" onChange={event => setSeed(event.target.value)} />
          </label>
          <button type="submit" className="solid" disabled={busy}>Import seed</button>
        </form>
      ) : null}
      {mode === 'key' ? (
        <form className="field" onSubmit={(event) => {
          event.preventDefault();
          const key = parseImportKey(privkey);
          if (!key) {
            setNote('Paste a base58 private key.');
            return;
          }
          setBusy(true);
          importWallet({ privateKey: key })
            .then(() => finish('Key imported. The field is cleared. Maelstrom does not keep the key.'))
            .catch(() => finish('That key was not imported.'))
            .finally(() => setPrivkey(''));
        }}>
          <label>
            Private key
            <input type="password" value={privkey} autoComplete="off" spellCheck={false} onChange={event => setPrivkey(event.target.value)} />
          </label>
          <button type="submit" className="solid" disabled={busy}>Import key</button>
        </form>
      ) : null}
      {note ? <p className="quiet" role="status">{note}</p> : null}
    </div>
  );
}

function WalletSwitcher({ rows, activeId, onSelect }) {
  if (!rows.length) return <p className="quiet">No wallet yet.</p>;
  return (
    <div className="wallet-switcher" role="tablist" aria-label="Wallets">
      {rows.map(row => (
        <Spotlight key={row.id} className={`wallet-switcher-row${activeId === row.id ? ' is-on' : ''}`}>
          <button
            type="button"
            role="tab"
            aria-selected={activeId === row.id}
            className="wallet-switcher-pick"
            onClick={() => onSelect(row.id)}
          >
            {row.label}
          </button>
          <AddressCopy address={row.address} compact />
        </Spotlight>
      ))}
    </div>
  );
}

function SendPane({
  active,
  destinations = [],
  tokens,
  frozen,
  observing = false,
  onSend,
  onReceipt,
  resolveRecipient = null,
}) {
  const [to, setTo] = useState('');
  const [pickedId, setPickedId] = useState('');
  const [amount, setAmount] = useState('');
  const [symbol, setSymbol] = useState('USDC');
  const [status, setStatus] = useState('');
  const [resetKey, setResetKey] = useState(0);
  const [folded, setFolded] = useState(false);
  const asset = tokens.find(token => token.symbol === symbol) || tokens[0] || null;
  const picked = destinations.find(row => row.id === pickedId && to === row.caption) || null;
  const target = picked
    ? { kind: 'wallet', id: picked.id, address: picked.address, caption: picked.caption, spendable: picked.spendable }
    : parseSendTarget(to);
  const units = asset ? displayToUnits(amount, asset.decimals) : null;
  const [snsAddress, setSnsAddress] = useState('');
  const [snsFailed, setSnsFailed] = useState(false);
  const [handleRecipient, setHandleRecipient] = useState(null);
  const [handleLooking, setHandleLooking] = useState(false);
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
  useEffect(() => {
    if (target?.kind !== 'handle') {
      setHandleRecipient(null);
      setHandleLooking(false);
      return undefined;
    }
    let stop = false;
    setHandleRecipient(null);
    setHandleLooking(true);
    const token = `@${target.handle}`;
    const lookup = typeof resolveRecipient === 'function'
      ? resolveRecipient(token)
      : Promise.resolve({ kind: 'handle', handle: target.handle, missing: true });
    Promise.resolve(lookup)
      .then((recipient) => {
        if (stop) return;
        if (recipient?.kind === 'handle') setHandleRecipient(recipient);
        else setHandleRecipient({ kind: 'handle', handle: target.handle, missing: true });
        setHandleLooking(false);
      })
      .catch(() => {
        if (stop) return;
        setHandleRecipient({ kind: 'handle', handle: target.handle, missing: true });
        setHandleLooking(false);
      });
    return () => { stop = true; };
  }, [target?.kind, target?.handle, resolveRecipient]);
  const pricedSwap = asset && asset.symbol !== 'USDC'
    ? swapDraft(tokens, { from: asset.symbol, to: 'USDC', amountText: amount })
    : null;
  const walletReady = target?.kind === 'wallet' && target.spendable && asset?.symbol === 'USDC';
  const handleReady = target?.kind === 'handle' && !handleLooking && sendHandleReady(handleRecipient);
  const ready = Boolean(
    active && !frozen && !observing && target && units && asset
    && (
      walletReady
      || (target.kind === 'handle' && (
        (asset.symbol === 'USDC' && handleReady)
        || (asset.symbol !== 'USDC' && handleReady && pricedSwap?.broadcast === false && pricedSwap.url)
      ))
      || (target.kind === 'sns' && asset.symbol === 'USDC' && snsAddress)
    )
  );
  const destination = target?.kind === 'wallet'
    ? target.caption
    : target?.kind === 'handle'
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
        <SendToField
          value={to}
          destinations={destinations}
          selectedId={picked?.id || ''}
          onChange={(next) => { setTo(next); setStatus(''); setFolded(false); }}
          onPick={(row) => setPickedId(row?.id || '')}
        />
      </label>
      {target?.kind === 'sns' && snsFailed ? (
        <p className="quiet" role="status">Failed.</p>
      ) : target?.kind === 'sns' && snsAddress ? (
        <AddressCopy address={snsAddress} prefix={target.domain} />
      ) : target?.kind === 'handle' && sendHandleReady(handleRecipient) ? (
        <AddressCopy
          address={handleRecipient.address}
          prefix={handleRecipient.displayName || `@${handleRecipient.handle}`}
        />
      ) : target?.kind === 'handle' ? (
        <p className="quiet" role="status">
          {sendHandleHint(handleRecipient, { looking: handleLooking, handle: target.handle })}
        </p>
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
        <p className="quiet">This prices {asset.symbol} in USDC. The quote is mainnet pricing and is not broadcast. The slide sends that USDC on the platform ledger.</p>
      ) : null}
      <TxnPreview preview={preview} folded={folded} onToggle={() => setFolded(false)} />
      <SlideCommit
        label="Slide to send"
        doneLabel="Sending"
        disabled={!ready}
        resetKey={`${resetKey}:${to}:${amount}:${asset?.symbol || ''}`}
        onCommit={() => {
          const pending = {
            target,
            fromWalletId: active.id,
            amount: units,
            asset: asset.symbol,
            amountText: amount.trim(),
            quote: pricedSwap && pricedSwap.url ? pricedSwap : null,
          };
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
  if (!target) return 'Type a @handle or a .sol name, or pick a wallet.';
  if (target.kind === 'sns') return `Looking up ${target.domain}.`;
  if (target.kind === 'wallet' && target.spendable === false) return 'That wallet is read only.';
  if (target.kind === 'wallet') return `Sends USDC on Solana devnet to ${target.caption}.`;
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
  const draft = swapDraft(tokens, { from, to, amountText: amount });
  const output = draft.output || null;

  async function loadQuote() {
    setQuote('');
    if (!draft.url) {
      setStatus(draft.error === 'not_tradeable'
        ? 'That token is restricted.'
        : draft.error === 'invalid_amount'
          ? 'Enter an amount.'
          : 'Choose two different tradeable tokens.');
      return;
    }
    setStatus('Quoting…');
    try {
      const response = await fetch(draft.url);
      const body = await response.json().catch(() => ({}));
      const out = readQuoteOut(body);
      if (!response.ok || !out || !output) {
        setStatus('No quote. Nothing was signed.');
        return;
      }
      const shown = formatBaseUnits(out, output.decimals);
      const next = swapPreview({
        pay: amount.trim(),
        receive: shown,
        from: draft.input.symbol,
        to: output.symbol,
      });
      setQuote(`${shown} ${output.symbol}`);
      onReceipt?.({
        id: `quote_${draft.input.symbol}_${output.symbol}_${draft.amount}_${shown}`,
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
    <form
      className="wallet-form field swap-form"
      onSubmit={(event) => {
        event.preventDefault();
        loadQuote();
      }}
    >
      <p className="quiet">A quote only. Nothing is signed from this screen.</p>
      <label>
        From
        <select value={from} onChange={event => { setFrom(event.target.value); setQuote(''); }}>
          {tokens.map(token => <option key={token.symbol} value={token.symbol}>{token.symbol}</option>)}
        </select>
      </label>
      <label>
        To
        <select value={to} onChange={event => { setTo(event.target.value); setQuote(''); }}>
          {tokens.map(token => <option key={`to-${token.symbol}`} value={token.symbol}>{token.symbol}</option>)}
        </select>
      </label>
      <label>
        Amount
        <input value={amount} inputMode="decimal" placeholder="0.00" onChange={event => { setAmount(event.target.value); setQuote(''); }} />
      </label>
      <button type="submit" className="solid" disabled={!draft.url}>Get quote</button>
      {quote ? <p className="wallet-figure wallet-figure-sm">{quote}</p> : null}
      {status ? <p className="quiet" role="status">{status}</p> : null}
    </form>
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
