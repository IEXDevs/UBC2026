'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useImportSeedPhrase, useLinkAccount, usePrivy } from '@privy-io/react-auth';
import { useCreateWallet, useImportWallet } from '@privy-io/react-auth/solana';
import { Plus, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, ChartNoAxesCombined, Coins, History, KeyRound, Layers, Wallet, X } from 'lucide-react';
import BotHistory from './BotHistory';
import AddressCopy from './AddressCopy';
import GlideSelect from './GlideSelect';
import PortfolioGraph from './PortfolioGraph';
import PrivyKeyButton from './PrivyKeyButton';
import TokenScreen from './TokenScreen';
import ConnectedWallets from './ConnectedWallets';
import SlideCommit from './bits/SlideCommit';
import TxnLog from './TxnLog';
import SendToField from './SendToField';
import TxnPreview from './TxnPreview';
import { usePresence } from './usePresence';
import { enrichPortfolio } from '../lib/dex-token.mjs';
import { partyFromToken } from '../lib/party-book.mjs';
import { embeddedCreateOptions, embeddedSolanaCount } from '../lib/wallet-provision.mjs';
import { portfolioErrorNote } from '../lib/portfolio.mjs';
import { cachedPortfolio, rememberPortfolio } from '../lib/portfolio-cache.mjs';
import { describeWallets, formatBaseUnits, recentCounterparties, sendDestinations, shortAddress, walletGlance } from '../lib/money-views.mjs';
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
import { accountStorage } from '../lib/account-state.mjs';
import { sendPreview } from '../lib/txn-preview.mjs';
import { previewPortfolioFor } from '../lib/dev-preview.mjs';

const PANES = [
  { id: 'assets', label: 'Overview', icon: Layers, description: 'Your balances and assets, at a glance.' },
  { id: 'wallets', label: 'Connections', icon: Wallet, description: 'Manage your connected Solana wallets.' },
  { id: 'portfolio', label: 'Portfolio', icon: ChartNoAxesCombined, description: 'See how your assets are distributed.' },
  { id: 'send', label: 'Send', icon: ArrowUpRight, description: 'Transfer funds from your agent wallet.' },
  { id: 'receive', label: 'Receive', icon: ArrowDownLeft, description: 'Your wallet address and payment details.' },
  { id: 'swap', label: 'Swap', icon: ArrowLeftRight, description: 'Review a token swap before confirming.' },
  { id: 'tokens', label: 'Tokens', icon: Coins, description: 'Choose which tokens appear in your wallet.' },
  { id: 'history', label: 'Activity', icon: History, description: 'Your recent transactions.' },
  { id: 'keys', label: 'Security', icon: KeyRound, description: 'Manage your wallet keys securely with Privy.' },
];

export default function WalletsSheet({
  open,
  onClose,
  state,
  transfers = [],
  bot = null,
  onParty,
  signedIn = false,
  ownerId = '',
  handle = '',
  sns = '',
  onSend,
  onReceipt,
  focusId = '',
  getAccessToken,
  resolveRecipient = null,
  devnetBalance = null,
  onRetire = null,
  devPreview = false,
}) {
  const { mounted, leaving } = usePresence(open);
  const [pane, setPane] = useState('assets');
  const [walletId, setWalletId] = useState('');
  const [prefs, setPrefs] = useState(emptyTokenPrefs);
  const [retiring, setRetiring] = useState('');
  const [retireNote, setRetireNote] = useState('');

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
    if (key) accountStorage.setItem(key, JSON.stringify(clean));
  }

  const wallets = (state?.wallets || []).filter(wallet => wallet && !wallet.deletedAt && !wallet.deleted_at);
  const bots = state?.bots || [];
  const positions = state?.positions || [];
  const glance = walletGlance(wallets, positions, transfers);
  const rows = describeWallets(wallets, bots);
  const active = rows.find(row => row.id === walletId) || rows[0] || null;
  const activeRaw = wallets.find(wallet => wallet.id === active?.id) || null;
  const observing = activeRaw?.spendable === false;
  const ownDestinations = sendDestinations(wallets, bots, active?.id || '');
  const destinations = [
    ...ownDestinations,
    ...recentCounterparties(transfers, state?.payments || []).filter(row => (
      !ownDestinations.some(item => item.caption.toLowerCase() === row.caption.toLowerCase())
    )),
  ];
  const needsWallet = pane === 'send' || pane === 'receive' || pane === 'swap';
  const previewBook = useMemo(() => (
    devPreview && activeRaw?.address
      ? previewPortfolioFor([{ kind: 'main', address: activeRaw.address, label: activeRaw.label }])
      : null
  ), [devPreview, activeRaw?.address, activeRaw?.label]);
  const tokens = deskTokens({
    positions,
    transfers,
    prefs: { ...prefs, sns: prefs.sns || sns || '' },
    devnet: devnetBalance,
  });

  if (!mounted || typeof document === 'undefined') return null;

  // The animated shell creates a containing block for fixed-position children.
  // Keep this overlay anchored to the viewport, including on long mobile desks.
  return createPortal(
    <div className={`backdrop is-center ${leaving ? 'is-leaving' : ''}`} onMouseDown={onClose}>
      <section
        className="sheet wallets-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallets-title"
        onMouseDown={event => event.stopPropagation()}
      >
        <nav className="wallet-nav" aria-label="Wallet sections">
          <strong id="wallets-title"><Wallet size={19} />Wallets</strong>
          {PANES.map(item => (
            <button
              key={item.id}
              type="button"
              className={pane === item.id ? 'is-on' : ''}
              aria-current={pane === item.id ? 'page' : undefined}
              onClick={() => setPane(item.id)}
            >
              <item.icon size={17} strokeWidth={1.7} />
              {item.label}
            </button>
          ))}
          <span className="wallet-network"><i />Solana devnet</span>
        </nav>
        <div className="wallet-body">
          <div className="sheet-head">
            <div><p className="plugin-kicker">Wallets</p><h2>{PANES.find(item => item.id === pane)?.label}</h2><p className="quiet">{PANES.find(item => item.id === pane)?.description}</p></div>
            <button type="button" className="icon-btn" aria-label="Close wallets" onClick={onClose}>
              <X size={18} strokeWidth={1.75} />
            </button>
          </div>
          {pane === 'wallets' ? <ConnectedWallets wallets={wallets} /> : null}
          {needsWallet ? <WalletPick rows={rows} activeId={active?.id || ''} onSelect={setWalletId} /> : null}
          {pane === 'assets' ? (
            <>
              {signedIn ? <WalletAdd /> : <p className="quiet">Sign in to add a wallet.</p>}
              <WalletRoster
                rows={rows}
                activeId={active?.id || ''}
                onSelect={setWalletId}
                retiring={retiring}
                onRetire={async (row) => {
                  setRetiring(row.id);
                  setRetireNote('');
                  try {
                    const result = await onRetire?.(row);
                    setRetireNote(result?.ok
                      ? `${row.label} is no longer on this account.`
                      : (result?.message || 'That wallet is still on the account.'));
                  } catch {
                    setRetireNote('That wallet is still on the account.');
                  } finally {
                    setRetiring('');
                  }
                }}
              />
              {retireNote ? <p className="quiet" role="status">{retireNote}</p> : null}
              {signedIn && active?.address ? (
                <>
                <div className="wallet-quick-actions">
                  <button type="button" onClick={() => setPane('send')}><ArrowUpRight size={18} /><span>Send</span></button>
                  <button type="button" onClick={() => setPane('receive')}><ArrowDownLeft size={18} /><span>Receive</span></button>
                  <button type="button" onClick={() => setPane('swap')}><ArrowLeftRight size={18} /><span>Swap</span></button>
                  <button type="button" onClick={() => setPane('wallets')}><Wallet size={18} /><span>Wallets</span></button>
                </div>
                <TokenScreen
                  open={open}
                  address={active.address}
                  previewPortfolio={previewBook}
                  onSend={() => setPane('send')}
                  onReceive={() => setPane('receive')}
                  onSwap={() => setPane('swap')}
                />
                </>
              ) : null}
              {!signedIn ? <p className="quiet">Sign in to read the assets in your wallets.</p> : null}
            </>
          ) : null}
          {pane === 'portfolio' ? (
            signedIn ? <ConnectedPortfolio open={open} previewPortfolio={previewBook} /> : <p className="quiet">Sign in to read balances.</p>
          ) : null}
          {pane === 'send' ? (
            <SendPane
              active={active}
              destinations={destinations}
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
          {pane === 'swap' ? <SwapPane tokens={tradeableTokens(tokens)} /> : null}
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
              {signedIn ? <WalletAdd /> : <p className="quiet">Sign in to create or import a wallet.</p>}
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
    </div>,
    document.body
  );
}

function linkedKey(user) {
  const accounts = Array.isArray(user?.linkedAccounts)
    ? user.linkedAccounts
    : (Array.isArray(user?.linked_accounts) ? user.linked_accounts : []);
  return accounts.map(account => (typeof account?.address === 'string' ? account.address : '')).join('|');
}

function ConnectedPortfolio({ open, previewPortfolio = null }) {
  const { user, getAccessToken, unlinkWallet, ready, authenticated } = usePrivy();
  const [portfolio, setPortfolio] = useState(null);
  const [error, setError] = useState('');
  const { linkWallet } = useLinkAccount({
    onError: () => setError('That wallet could not be linked. If it already belongs to another account, sign in with it instead.'),
  });
  const [loading, setLoading] = useState(false);
  const [removing, setRemoving] = useState('');
  const accounts = linkedKey(user);

  useEffect(() => {
    if (!open) return undefined;
    if (previewPortfolio) {
      setPortfolio(previewPortfolio);
      setError('');
      setLoading(false);
      let stopped = false;
      enrichPortfolio(previewPortfolio, { storage: window.localStorage })
        .then((enriched) => {
          if (!stopped) setPortfolio(enriched.portfolio);
        })
        .catch(() => {})
        .finally(() => {
          if (!stopped) setLoading(false);
        });
      return () => { stopped = true; };
    }
    const cacheKey = user?.id || accounts || 'portfolio';
    const cached = cachedPortfolio(cacheKey);
    if (cached) {
      setPortfolio(cached);
      setError('');
      setLoading(false);
    } else {
      setLoading(true);
      setError('');
    }
    let stopped = false;
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
        rememberPortfolio(cacheKey, body);
        setPortfolio(body);
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
        if (!stopped) {
          setPortfolio(null);
          setError(portfolioErrorNote({ error: 'rpc_failed' }));
        }
      } finally {
        if (!stopped) setLoading(false);
      }
    })();
    return () => { stopped = true; };
  }, [open, accounts, getAccessToken, user?.id, previewPortfolio]);

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
        if (!ready || !authenticated) {
          setError('Sign in again, then connect a wallet.');
          return;
        }
        linkWallet({ walletChainType: 'solana-only' });
      }}
      onRemove={remove}
    />
  );
}

export function WalletAdd() {
  const { createWallet } = useCreateWallet();
  const { importWallet } = useImportWallet();
  const { importSeedPhrase } = useImportSeedPhrase();
  const { user, ready, authenticated } = usePrivy();
  const connecting = useRef(false);
  const [mode, setMode] = useState('');
  const [seed, setSeed] = useState('');
  const [privkey, setPrivkey] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [hint, setHint] = useState('');
  const { linkWallet } = useLinkAccount({
    onSuccess: () => {
      if (!connecting.current) return;
      connecting.current = false;
      setNote('Wallet connected.');
    },
    onError: () => {
      connecting.current = false;
      setNote('That wallet could not be linked. If it already belongs to another account, sign in with it instead.');
    },
  });

  function finish(message) {
    setMode('');
    setSeed('');
    setPrivkey('');
    setBusy(false);
    setNote(message);
  }

  function showHint(text) {
    return {
      onMouseEnter: () => setHint(text),
      onFocus: () => setHint(text),
      onMouseLeave: () => setHint(''),
      onBlur: () => setHint(''),
    };
  }

  return (
    <div className="wallet-add">
      <button
        type="button"
        className="wallet-add-connect"
        disabled={busy}
        {...showHint('Opens Phantom, Solflare, Backpack, or another Solana wallet and links it to this account.')}
        onClick={() => {
          setMode('');
          setNote('');
          if (!ready || !authenticated) {
            setNote('Sign in again, then connect a wallet.');
            return;
          }
          connecting.current = true;
          linkWallet({
            walletChainType: 'solana-only',
            description: 'Connect a Solana wallet to this account.',
          });
        }}
      >
        Connect a wallet
      </button>
      <div className="wallet-switch wallet-add-create" role="group" aria-label="Create or import a wallet">
        <button
          type="button"
          disabled={busy}
          {...showHint('Creates another Solana wallet on this account. The key stays in Privy. Maelstrom does not store it.')}
          onClick={() => {
            setMode('');
            setBusy(true);
            setNote('');
            const count = embeddedSolanaCount(user);
            const options = embeddedCreateOptions(count);
            const run = (next) => (next ? createWallet(next) : createWallet());
            run(options)
              .then(() => finish('New wallet created. Maelstrom does not store its key.'))
              .catch(() => {
                if (count > 0) {
                  finish('That wallet was not created.');
                  return null;
                }
                return run({ walletIndex: 1 })
                  .then(() => finish('New wallet created. Maelstrom does not store its key.'))
                  .catch(() => finish('That wallet was not created.'));
              });
          }}
        >
          <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
          New Wallet
        </button>
        <button
          type="button"
          disabled={busy}
          aria-pressed={mode === 'seed'}
          {...showHint('Bring in a wallet from a 12-word phrase. The phrase is not saved here.')}
          onClick={() => { setMode(current => current === 'seed' ? '' : 'seed'); setPrivkey(''); setSeed(''); setNote(''); }}
        >
          Import seed
        </button>
        <button
          type="button"
          disabled={busy}
          aria-pressed={mode === 'key'}
          {...showHint('Bring in a wallet from a base58 private key. The key is not saved here.')}
          onClick={() => { setMode(current => current === 'key' ? '' : 'key'); setSeed(''); setPrivkey(''); setNote(''); }}
        >
          Import key
        </button>
      </div>
      {hint ? <p className="quiet wallet-add-hint">{hint}</p> : null}
      <p className="quiet">The phrase and the private key are not stored here.</p>
      {mode === 'seed' ? (
        <form className="field" onSubmit={(event) => {
          event.preventDefault();
          const words = seed.trim().toLowerCase().split(/\s+/).filter(Boolean);
          setMode('');
          setSeed('');
          setBusy(true);
          verifyRecoveryPhrase(words).then(valid => {
            if (!valid) {
              setBusy(false);
              setNote('Type a 12-word seed phrase.');
              return null;
            }
            return importSeedPhrase({ mnemonic: words.join(' '), chainType: 'solana' })
              .then(() => finish('Seed imported. Maelstrom does not keep the phrase.'));
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
          setMode('');
          setPrivkey('');
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

function WalletRoster({ rows, activeId, onSelect, onRetire, retiring }) {
  if (!rows.length) return <p className="quiet">No wallet on this account yet. Connect one above, or generate a new one.</p>;
  return (
    <div className="wallet-roster" role="list" aria-label="Wallets">
      {rows.map(row => (
        <div key={row.id} className={`wallet-roster-row${activeId === row.id ? ' is-on' : ''}`}>
          <button
            type="button"
            className="wallet-roster-pick"
            aria-pressed={activeId === row.id}
            onClick={() => onSelect(row.id)}
          >
            <strong>{row.label}</strong>
            <small>{row.kind === 'main' ? 'Main' : 'Additional'}{row.frozen ? ' · Frozen' : ''}</small>
          </button>
          <AddressCopy address={row.address} compact />
          {row.kind === 'additional' ? (
            <button
              type="button"
              className="wallet-retire"
              disabled={retiring === row.id}
              onClick={() => onRetire?.(row)}
            >
              {retiring === row.id ? 'Removing' : 'Remove'}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function WalletPick({ rows, activeId, onSelect }) {
  if (!rows.length) return <p className="quiet">No wallet on this account yet. Connect one in settings, or generate a new one.</p>;
  return (
    <label className="wallet-pick-label">
      Wallet
      <GlideSelect
        className="wallet-pick"
        ariaLabel="Wallet"
        size="md"
        menuWidth={420}
        accentColor="#e4c27a"
        surfaceColor="#1a2422"
        highlightColor="#243833"
        textColor="#f6f3ea"
        value={activeId}
        options={rows.map(row => ({
          value: row.id,
          label: `${row.label} · ${shortAddress(row.address)}`,
          tag: row.kind === 'main' ? 'Main' : 'Added',
        }))}
        onChange={onSelect}
      />
    </label>
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
  const target = picked?.kind === 'recent'
    ? parseSendTarget(picked.caption)
    : picked
      ? { kind: 'wallet', id: picked.id, address: picked.address, caption: picked.caption, spendable: picked.spendable, walletKind: picked.walletKind }
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
  const fundingMain = observing
    && target?.kind === 'wallet'
    && target.walletKind === 'main'
    && asset?.symbol === 'USDC';
  const walletReady = target?.kind === 'wallet' && target.spendable && asset?.symbol === 'USDC';
  const handleReady = target?.kind === 'handle' && !handleLooking && sendHandleReady(handleRecipient);
  const ready = Boolean(
    active && !frozen && target && units && asset
    && (
      fundingMain
      || (!observing && (
        walletReady
        || (target.kind === 'handle' && (
          (asset.symbol === 'USDC' && handleReady)
          || (asset.symbol !== 'USDC' && handleReady && pricedSwap?.broadcast === false && pricedSwap.url)
        ))
        || (target.kind === 'sns' && asset.symbol === 'USDC' && snsAddress)
      ))
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
      ) : target?.kind === 'invalid-address' || target?.kind === 'address' ? (
        <p className="quiet" role="status">{targetHint(target, observing)}</p>
      ) : (
        <p className="quiet">{targetHint(target, observing)}</p>
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

function targetHint(target, observing = false) {
  if (observing) {
    if (target?.kind === 'wallet' && target.walletKind === 'main') {
      return 'This sends devnet USDC to the main wallet. The connected wallet approves it.';
    }
    return 'A connected wallet sends devnet USDC to the main wallet.';
  }
  if (!target) return 'Type a @handle or a .sol name, or pick a wallet.';
  if (target.kind === 'sns') return `Looking up ${target.domain}.`;
  if (target.kind === 'wallet' && target.spendable === false) return 'Pick the main wallet to move funds there.';
  if (target.kind === 'wallet') return `Sends USDC on Solana devnet to ${target.caption}.`;
  if (target.kind === 'invalid-address') return 'That address is not a valid Solana pubkey.';
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

function SwapPane({ tokens }) {
  const [from, setFrom] = useState(tokens[0]?.symbol || 'USDC');
  const [to, setTo] = useState(tokens[1]?.symbol || 'SOL');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState('');
  const [quote, setQuote] = useState('');
  const draft = swapDraft(tokens, { from, to, amountText: amount });
  const decimals = draft.output?.decimals;
  const symbol = draft.output?.symbol || '';
  const quoteUrl = draft.url || '';
  const options = tokens.map(token => ({ value: token.symbol, label: token.symbol }));

  useEffect(() => {
    if (!quoteUrl || !Number.isInteger(decimals)) {
      setQuote('');
      if (amount.trim() && draft.error) {
        setStatus(draft.error === 'not_tradeable'
          ? 'That token is restricted.'
          : draft.error === 'invalid_amount'
            ? 'Enter an amount.'
            : 'Choose two different tokens.');
      } else {
        setStatus('');
      }
      return undefined;
    }
    let stop = false;
    setStatus('Quoting…');
    const timer = setTimeout(() => {
      fetch(quoteUrl)
        .then(response => response.json().then(body => ({ ok: response.ok, body })))
        .then(({ ok, body }) => {
          if (stop) return;
          const out = readQuoteOut(body);
          if (!ok || !out) {
            setQuote('');
            setStatus('No quote. Nothing was signed.');
            return;
          }
          setQuote(`${formatBaseUnits(out, decimals)} ${symbol}`);
          setStatus('Quote ready. Nothing was signed.');
        })
        .catch(() => {
          if (!stop) {
            setQuote('');
            setStatus('The quote did not load. Nothing was signed.');
          }
        });
    }, 350);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [quoteUrl, decimals, symbol, amount, draft.error]);

  return (
    <form className="wallet-form field swap-form" onSubmit={event => event.preventDefault()}>
      <p className="quiet">A quote fills in as you type. Nothing is signed from this screen.</p>
      <label className="wallet-pick-label">
        From
        <GlideSelect
          className="wallet-pick"
          ariaLabel="From"
          menuWidth={420}
          accentColor="#e4c27a"
          surfaceColor="#1a2422"
          highlightColor="#243833"
          textColor="#f6f3ea"
          value={from}
          options={options}
          onChange={(next) => { setFrom(next); setQuote(''); }}
        />
      </label>
      <label className="wallet-pick-label">
        To
        <GlideSelect
          className="wallet-pick"
          ariaLabel="To"
          menuWidth={420}
          accentColor="#e4c27a"
          surfaceColor="#1a2422"
          highlightColor="#243833"
          textColor="#f6f3ea"
          value={to}
          options={options}
          onChange={(next) => { setTo(next); setQuote(''); }}
        />
      </label>
      <label>
        Amount
        <input value={amount} inputMode="decimal" placeholder="0.00" onChange={event => { setAmount(event.target.value); setQuote(''); }} />
      </label>
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
