'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useImportSeedPhrase, useLinkAccount, usePrivy } from '@privy-io/react-auth';
import { useCreateWallet, useImportWallet } from '@privy-io/react-auth/solana';
import { ChevronDown, Plus, Settings2, X } from 'lucide-react';
import BotHistory from './BotHistory';
import AddressCopy from './AddressCopy';
import GlideSelect from './GlideSelect';
import JupiterSwap from './JupiterSwap';
import PortfolioGraph from './PortfolioGraph';
import PrivyKeyButton from './PrivyKeyButton';
import TokenScreen from './TokenScreen';
import SlideCommit from './bits/SlideCommit';
import TxnLog from './TxnLog';
import SendToField from './SendToField';
import TxnPreview from './TxnPreview';
import LinkedLogins from './LinkedLogins';
import { usePresence } from './usePresence';
import { enrichPortfolio } from '../lib/dex-token.mjs';
import { partyFromToken } from '../lib/party-book.mjs';
import { embeddedCreateOptions, embeddedSolanaCount } from '../lib/wallet-provision.mjs';
import { portfolioErrorNote } from '../lib/portfolio.mjs';
import { cachedPortfolio, rememberPortfolio } from '../lib/portfolio-cache.mjs';
import { describeWallets, recentCounterparties, sendDestinations, shortAddress, walletGlance } from '../lib/money-views.mjs';
import {
  deskTokens,
  displayToUnits,
  emptyTokenPrefs,
  normalizeTokenPrefs,
  parseImportKey,
  parseSendTarget,
  swapDraft,
  verifyRecoveryPhrase,
  tokenStorageKey,
  tradeableTokens,
} from '../lib/wallet-desk.mjs';
import { sendHandleHint, sendHandleReady } from '../lib/profile.mjs';
import { accountStorage } from '../lib/account-state.mjs';
import { sendPreview } from '../lib/txn-preview.mjs';
import { previewPortfolioFor } from '../lib/dev-preview.mjs';
import { swapReceipt } from '../lib/jupiter-plugin.mjs';

const TRANSFER = [
  { id: 'send', label: 'Send' },
  { id: 'receive', label: 'Receive' },
  { id: 'swap', label: 'Swap' },
];
const TRANSFER_EASE = [0.22, 1, 0.36, 1];

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
  solanaBalance = null,
  onRetire = null,
  devPreview = false,
}) {
  const { mounted, leaving } = usePresence(open);
  const [root, setRoot] = useState(null);
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  const [balanceRevision, setBalanceRevision] = useState(0);
  const settingsRef = useRef(null);
  const transferRef = useRef(null);
  const bodyRef = useRef(null);
  const [transfer, setTransfer] = useState('send');
  const [transferDir, setTransferDir] = useState(1);
  const reduceMotion = useReducedMotion();
  const [walletId, setWalletId] = useState('');
  const [prefs, setPrefs] = useState(emptyTokenPrefs);
  const [retiring, setRetiring] = useState('');
  const [retireNote, setRetireNote] = useState('');
  const [swapMint, setSwapMint] = useState('');

  useEffect(() => {
    setRoot(document.body);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

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

  function chooseTransfer(section) {
    const next = TRANSFER.findIndex(item => item.id === section);
    const current = TRANSFER.findIndex(item => item.id === transfer);
    if (next >= 0 && current >= 0 && next !== current) setTransferDir(next > current ? 1 : -1);
    setTransfer(section);
  }

  function openTransfer(section) {
    chooseTransfer(section);
    scrollToSection(transferRef.current);
  }

  function scrollToSection(section) {
    const body = bodyRef.current;
    if (!body || !section) return;
    body.scrollTo({
      top: body.scrollTop + section.getBoundingClientRect().top - body.getBoundingClientRect().top - 16,
      behavior: reduceMotion ? 'instant' : 'smooth',
    });
  }

  function openParty(party) {
    if (!onParty) return;
    onClose();
    onParty(party);
  }

  async function send(pending) {
    const result = await onSend?.(pending);
    if (result?.ok) setBalanceRevision(value => value + 1);
    return result;
  }

  function swapped(signature) {
    setBalanceRevision(value => value + 1);
    const receipt = swapReceipt({ signature, walletLabel: active?.label || '' });
    if (receipt) onReceipt?.(receipt);
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
  const heading = TRANSFER.find(item => item.id === transfer)?.label || 'Send';
  const previewBook = useMemo(() => (
    devPreview && activeRaw?.address
      ? previewPortfolioFor([{ kind: 'main', address: activeRaw.address, label: activeRaw.label }])
      : null
  ), [devPreview, activeRaw?.address, activeRaw?.label]);
  const tokens = deskTokens({
    positions,
    transfers,
    prefs: { ...prefs, sns: prefs.sns || sns || '' },
    solana: solanaBalance,
  });

  if (!mounted || !root) return null;

  return createPortal(
    <div className={`backdrop is-center wallet-backdrop ${leaving ? 'is-leaving' : ''}`} onMouseDown={onClose}>
      <section
        className="sheet wallets-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallets-title"
        onMouseDown={event => event.stopPropagation()}
      >
        <header className="wallet-header">
          <div>
            <h2 id="wallets-title">Wallet</h2>
            <p className="quiet">Your assets, transfers, and activity. Together.</p>
          </div>
          <div className="wallet-header-actions">
            <button type="button" className="ghost wallet-manage" onClick={() => {
              if (!settingsRef.current) return;
              settingsRef.current.open = true;
              scrollToSection(settingsRef.current);
            }}>
              <Settings2 size={15} aria-hidden="true" />
              Manage wallets
            </button>
            <button type="button" className="icon-btn" aria-label="Close wallets" onClick={onClose}>
              <X size={18} strokeWidth={1.75} />
            </button>
          </div>
        </header>
        <div className="wallet-body" ref={bodyRef}>
          <div className="wallet-overview">
            <section className="wallet-card wallet-assets" aria-label="Wallet assets">
              <WalletPick rows={rows} handle={handle} activeId={active?.id || ''} onSelect={setWalletId} />
              {active?.address ? (
                <div className="wallet-identity">
                  <AddressCopy address={active.address} compact />
                  <span className="wallet-status">{active.frozen ? 'Frozen' : observing ? 'Connected' : 'Ready'}</span>
                </div>
              ) : null}
              {signedIn && active?.address ? (
                <TokenScreen
                  key={active.id}
                  refreshKey={balanceRevision}
                  open={open}
                  address={active.address}
                  previewPortfolio={previewBook}
                  onSend={() => openTransfer('send')}
                  onReceive={() => openTransfer('receive')}
                  onSwap={(symbol, mint) => {
                    setSwapMint(mint || tokens.find(token => token.symbol === symbol)?.mint || '');
                    openTransfer('swap');
                  }}
                />
              ) : <p className="quiet">{signedIn ? 'Add a wallet to see its assets here.' : 'Sign in to read the assets in your wallets.'}</p>}
              <details className="wallet-fold wallet-allocation" onToggle={event => setPortfolioOpen(event.currentTarget.open)}>
                <summary>Portfolio breakdown<ChevronDown size={16} aria-hidden="true" /></summary>
                <div className="wallet-fold-body">
                  {signedIn ? <ConnectedPortfolio key={balanceRevision} open={open && portfolioOpen} previewPortfolio={previewBook} /> : <p className="quiet">Sign in to read balances.</p>}
                </div>
              </details>
            </section>
            <section className="wallet-card wallet-transfers" aria-label="Transfer" ref={transferRef}>
              <div className="wallet-switch wallet-action-switch" role="group" aria-label="Transfer actions">
                {TRANSFER.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={transfer === item.id}
                    className={transfer === item.id ? 'is-on' : ''}
                    onClick={() => chooseTransfer(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <h3 className="wallet-action-title">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={transfer}
                    className="transfer-title"
                    initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: reduceMotion ? 0 : -6 }}
                    transition={{ duration: reduceMotion ? 0 : 0.32, ease: TRANSFER_EASE }}
                  >{heading}</motion.span>
                </AnimatePresence>
              </h3>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={`${active?.id || 'empty'}:${transfer}`}
                  className="transfer-stage"
                  initial={{ opacity: 0, x: reduceMotion ? 0 : transferDir * 18 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: reduceMotion ? 0 : transferDir * -14 }}
                  transition={{ duration: reduceMotion ? 0 : 0.38, ease: TRANSFER_EASE }}
                >
                  {transfer === 'send' ? (
                    <SendPane
                      active={active}
                      destinations={destinations}
                      tokens={tradeableTokens(tokens)}
                      frozen={Boolean(active?.frozen)}
                      observing={observing}
                      onSend={send}
                      onReceipt={onReceipt}
                      resolveRecipient={resolveRecipient}
                    />
                  ) : null}
                  {transfer === 'receive' ? <ReceivePane active={active} handle={handle} /> : null}
                  {transfer === 'swap' ? (
                    <JupiterSwap
                      address={active?.address || ''}
                      label={active?.label || ''}
                      frozen={Boolean(active?.frozen)}
                      inputMint={swapMint}
                      onSwapped={swapped}
                    />
                  ) : null}
                </motion.div>
              </AnimatePresence>
            </section>
          </div>
          <details className="wallet-fold" open>
            <summary>Recent activity<ChevronDown size={16} aria-hidden="true" /></summary>
            <div className="wallet-fold-body">
              {bot ? (
                <BotHistory bot={bot} bots={bots} payments={state?.payments || []} transfers={transfers} onParty={openParty} />
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
                  onParty={openParty}
                  empty="No history yet."
                />
              )}
            </div>
          </details>
          <details className="wallet-fold wallet-settings" ref={settingsRef}>
            <summary>Wallet settings<ChevronDown size={16} aria-hidden="true" /></summary>
            <div className="wallet-fold-body wallet-settings-grid">
              <section aria-label="Manage wallets">
                <h3>Manage wallets</h3>
                {signedIn ? <WalletAdd /> : <p className="quiet">Sign in to create or import a wallet.</p>}
                <WalletRoster
                  rows={rows}
                  handle={handle}
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
              </section>
              <section aria-label="Sign-in and keys">
                <h3>Sign-in methods</h3>
                {signedIn ? <LinkedLogins /> : <p className="quiet">Sign in to link email, Google, GitHub, or Discord.</p>}
                <h3>Recovery &amp; keys</h3>
                <PrivyKeyButton
                  key={active?.id || 'empty'}
                  signedIn={signedIn}
                  address={active?.address || glance.address}
                  walletId={activeRaw?.privyWalletId || ''}
                  ownerId={ownerId}
                  getAccessToken={getAccessToken}
                />
              </section>
              <section className="wallet-token-settings" aria-label="Token preferences">
                <h3>Token preferences</h3>
                <TokenPane tokens={tokens} prefs={prefs} onSave={savePrefs} />
              </section>
            </div>
          </details>
        </div>
      </section>
    </div>,
    root,
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
      <p className="quiet wallet-add-hint" aria-live="polite">{hint || 'The phrase and the private key are not stored here.'}</p>
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

function WalletRoster({ rows, handle = '', activeId, onSelect, onRetire, retiring }) {
  const name = typeof handle === 'string' ? handle.trim().replace(/^@/, '') : '';
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
            {name ? <span className="wallet-roster-handle">@{name}</span> : null}
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

function WalletPick({ rows, handle = '', activeId, onSelect }) {
  const name = typeof handle === 'string' ? handle.trim().replace(/^@/, '') : '';
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
          label: `${row.label}${name ? ` · @${name}` : ''} · ${shortAddress(row.address)}`,
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
  const [sendComplete, setSendComplete] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [folded, setFolded] = useState(false);
  const asset = tokens.find(token => token.symbol === symbol) || tokens[0] || null;
  const picked = destinations.find(row => row.id === pickedId && to === row.caption) || null;
  const target = picked?.kind === 'recent'
    ? parseSendTarget(picked.caption)
    : picked
      ? { kind: 'wallet', id: picked.id, address: picked.address, caption: picked.caption, frozen: picked.frozen, walletKind: picked.walletKind }
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
  const walletReady = target?.kind === 'wallet' && !target.frozen && asset?.symbol === 'USDC';
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
      <p className="quiet">{active ? `From ${active.label}.` : 'No wallet yet.'} A slide confirms the send. Nothing is signed before that.</p>
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
        <p className="quiet">This prices {asset.symbol} in USDC. The quote doesn’t move funds. Sliding sends USDC on the platform ledger.</p>
      ) : null}
      <TxnPreview preview={preview} folded={folded} onToggle={() => setFolded(false)} />
      <SlideCommit
        label="Slide to send"
        doneLabel={sendComplete ? 'Sent' : 'Sending'}
        disabled={!ready}
        resetKey={`${resetKey}:${to}:${amount}:${asset?.symbol || ''}`}
        onCommit={() => {
          setSendComplete(false);
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
              setSendComplete(true);
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
      return 'This sends USDC to the main wallet. The connected wallet approves it.';
    }
    return 'A connected wallet sends USDC to the main wallet.';
  }
  if (!target) return 'Type a @handle or a .sol name, or pick a wallet.';
  if (target.kind === 'sns') return `Looking up ${target.domain}.`;
  if (target.kind === 'wallet') return `Sends USDC to ${target.caption}.`;
  if (target.kind === 'invalid-address') return 'That address is not a valid Solana pubkey.';
  return 'Raw addresses are not on the platform ledger yet.';
}

function ReceivePane({ active, handle }) {
  return (
    <div className="wallet-form">
      <p className="quiet">Share the address, or your @handle.</p>
      {handle ? <p className="wallet-handle">@{handle}</p> : <p className="quiet">Claim a @handle to get paid by name.</p>}
      <AddressCopy address={active?.address || ''} />
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
      <p className="quiet">Hidden tokens leave the asset list. Restricted tokens stay visible and cannot be sent here. USDC stays on both.</p>
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
