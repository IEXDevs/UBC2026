'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useConnectWallet, useImportSeedPhrase, useLinkAccount, usePrivy } from '@privy-io/react-auth';
import { useCreateWallet, useImportWallet, useWallets } from '@privy-io/react-auth/solana';
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronDown,
  CircleDollarSign,
  Copy,
  Plus,
  QrCode,
  Repeat,
  Settings2,
  X,
} from 'lucide-react';
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
import { exportWalletIdForSheet } from '../lib/privy-export.mjs';
import { walletPickLabel, walletPickTag } from '../lib/wallet-pick.mjs';
import { describeWallets, formatAmount, formatBaseUnits, recentCounterparties, sendDestinations, shortAddress, walletGlance } from '../lib/money-views.mjs';
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
import { walletSendAssets, NATIVE_SOL_MINT } from '../lib/wallet-send-assets.mjs';
import { swapReceipt } from '../lib/jupiter-plugin.mjs';
import { walletConnectionOptions } from '../lib/wallet-signing.mjs';

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
  onWalletCreated = null,
  devPreview = false,
}) {
  const { mounted, leaving } = usePresence(open);
  const [root, setRoot] = useState(null);
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  const [balanceRevision, setBalanceRevision] = useState(0);
  const [sendPortfolio, setSendPortfolio] = useState(null);
  const [preferredAsset, setPreferredAsset] = useState(null);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const settingsRef = useRef(null);
  const activityRef = useRef(null);
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
      if (event.key === 'Escape') {
        if (accountsOpen) setAccountsOpen(false);
        else onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, accountsOpen]);

  useEffect(() => {
    if (open && focusId) setWalletId(focusId);
  }, [open, focusId]);

  useEffect(() => {
    if (open && activityRef.current) activityRef.current.open = false;
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

  const displayHandle = handle ? (handle.startsWith('@') ? handle : `@${handle}`) : (sns ? sns : '@user');
  const activeInitial = (active?.label || 'W').slice(0, 2).toUpperCase();

  return createPortal(
    <div className={`backdrop is-center wallet-backdrop ${leaving ? 'is-leaving' : ''}`} onMouseDown={onClose}>
      <section
        className="sheet wallets-sheet phantom-wallets-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallets-title"
        onMouseDown={event => event.stopPropagation()}
      >
        {/* Phantom Left Accounts Rail / Drawer (matching Screenshot 4) */}
        <AnimatePresence>
          {accountsOpen ? (
            <motion.aside
              className="phantom-accounts-drawer"
              initial={{ x: -180, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -180, opacity: 0 }}
              transition={{ duration: 0.28, ease: TRANSFER_EASE }}
              aria-label="Account switcher"
            >
              <div className="phantom-drawer-header">
                <button
                  type="button"
                  className="phantom-drawer-back"
                  onClick={() => setAccountsOpen(false)}
                  aria-label="Back"
                >
                  <ArrowLeft size={18} strokeWidth={2.2} />
                </button>
              </div>

              <div className="phantom-drawer-list">
                {rows.map((row, idx) => {
                  const isActive = (active?.id || '') === row.id;
                  const labelInitial = row.label ? row.label.slice(0, 2).toUpperCase() : `A${idx + 1}`;
                  return (
                    <button
                      key={row.id}
                      type="button"
                      className={`phantom-drawer-avatar-btn ${isActive ? 'is-active' : ''}`}
                      onClick={() => {
                        setWalletId(row.id);
                        setAccountsOpen(false);
                      }}
                      title={row.label}
                    >
                      <span className="phantom-drawer-avatar">{labelInitial}</span>
                      <span className="phantom-drawer-name">{row.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="phantom-drawer-footer">
                <button
                  type="button"
                  className="phantom-drawer-foot-btn"
                  title="Add new wallet"
                  onClick={() => {
                    setAccountsOpen(false);
                    if (!settingsRef.current) return;
                    settingsRef.current.open = true;
                    scrollToSection(settingsRef.current);
                  }}
                >
                  <Plus size={18} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  className="phantom-drawer-foot-btn"
                  title="Wallet settings"
                  onClick={() => {
                    setAccountsOpen(false);
                    if (!settingsRef.current) return;
                    settingsRef.current.open = true;
                    scrollToSection(settingsRef.current);
                  }}
                >
                  <Settings2 size={18} strokeWidth={2} />
                </button>
              </div>
            </motion.aside>
          ) : null}
        </AnimatePresence>

        {/* Header */}
        <header className="wallet-header phantom-top-header">
          <div className="phantom-header-left">
            <button
              type="button"
              className="phantom-account-pill-btn"
              onClick={() => setAccountsOpen(prev => !prev)}
              title="Switch wallet"
            >
              <div className="phantom-avatar-circle">
                <span>{activeInitial}</span>
              </div>
              <div className="phantom-account-text">
                <span className="phantom-account-handle">{displayHandle}</span>
                <span className="phantom-account-sub">
                  {active?.label || 'wallet'}
                  <ChevronDown size={12} className="phantom-chevron" />
                </span>
              </div>
            </button>
          </div>

          <div className="wallet-header-actions phantom-header-actions">
            <button
              type="button"
              className="ghost wallet-manage phantom-manage-btn"
              onClick={() => {
                if (!settingsRef.current) return;
                settingsRef.current.open = true;
                scrollToSection(settingsRef.current);
              }}
            >
              <Settings2 size={16} aria-hidden="true" />
              <span>Manage</span>
            </button>
            <button type="button" className="icon-btn phantom-close-btn" aria-label="Close wallets" onClick={onClose}>
              <X size={18} strokeWidth={2} />
            </button>
          </div>
        </header>

        <div className="wallet-body phantom-wallet-body" ref={bodyRef}>
          <div className="wallet-overview">
            <section className="wallet-card wallet-assets phantom-assets-card" aria-label="Wallet assets">
              <div className="phantom-select-row">
                <WalletPick rows={rows} wallets={wallets} handle={handle} activeId={active?.id || ''} onSelect={setWalletId} />
              </div>

              {active?.address ? (
                <div className="wallet-identity sr-only">
                  <AddressCopy address={active.address} compact />
                  <span className="wallet-status">{active.frozen ? 'Frozen' : observing ? 'Linked' : 'Ready'}</span>
                </div>
              ) : null}

              {signedIn && observing ? <WalletConnection key={`connection:${active.id}`} wallet={activeRaw} /> : null}

              {signedIn && active?.address ? (
                <TokenScreen
                  key={active.id}
                  refreshKey={balanceRevision}
                  open={open}
                  address={active.address}
                  previewPortfolio={previewBook}
                  onPortfolio={setSendPortfolio}
                  onSend={holding => {
                    setPreferredAsset({ walletId: active.id, id: holding?.mint === NATIVE_SOL_MINT && holding.native !== false ? 'SOL' : holding?.mint });
                    openTransfer('send');
                  }}
                  onReceive={() => openTransfer('receive')}
                  onSwap={(symbol, mint) => {
                    setSwapMint(mint || tokens.find(token => token.symbol === symbol)?.mint || '');
                    openTransfer('swap');
                  }}
                />
              ) : <p className="quiet">{signedIn ? 'Add a wallet to see its assets here.' : 'Sign in to read the assets in your wallets.'}</p>}

              <details className="wallet-fold wallet-allocation phantom-allocation-fold" onToggle={event => setPortfolioOpen(event.currentTarget.open)}>
                <summary>Portfolio breakdown<ChevronDown size={16} aria-hidden="true" /></summary>
                <div className="wallet-fold-body">
                  {signedIn ? <ConnectedPortfolio key={balanceRevision} open={open && portfolioOpen} previewPortfolio={previewBook} onRetire={onRetire} onCreated={onWalletCreated} /> : <p className="quiet">Sign in to read balances.</p>}
                </div>
              </details>
            </section>

            <section className="wallet-card wallet-transfers phantom-transfers-card" aria-label="Transfer" ref={transferRef}>
              <div className="phantom-action-tiles" role="group" aria-label="Transfer actions">
                {TRANSFER.map(item => {
                  const isCurrent = transfer === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={isCurrent}
                      className={`phantom-action-tile ${isCurrent ? 'is-on' : ''}`}
                      onClick={() => chooseTransfer(item.id)}
                    >
                      <span className="phantom-action-tile-icon">
                        {item.id === 'send' ? <ArrowUpRight size={22} strokeWidth={2.4} /> : null}
                        {item.id === 'swap' ? <Repeat size={20} strokeWidth={2.4} /> : null}
                        {item.id === 'receive' ? <QrCode size={20} strokeWidth={2.4} /> : null}
                      </span>
                      <span className="phantom-action-tile-label">{item.label}</span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="phantom-action-tile phantom-tile-buy"
                  onClick={() => {
                    if (!settingsRef.current) return;
                    settingsRef.current.open = true;
                    scrollToSection(settingsRef.current);
                  }}
                >
                  <span className="phantom-action-tile-icon">
                    <CircleDollarSign size={20} strokeWidth={2.4} />
                  </span>
                  <span className="phantom-action-tile-label">Buy</span>
                </button>
              </div>

              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={`${active?.id || 'empty'}:${transfer}`}
                  className="transfer-stage phantom-transfer-stage"
                  initial={{ opacity: 0, x: reduceMotion ? 0 : transferDir * 18 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: reduceMotion ? 0 : transferDir * -14 }}
                  transition={{ duration: reduceMotion ? 0 : 0.38, ease: TRANSFER_EASE }}
                >
                  {transfer === 'send' ? (
                    <SendPane
                      active={active}
                      destinations={destinations}
                      tokens={walletSendAssets(sendPortfolio, active?.address)}
                      preferredAsset={preferredAsset?.walletId === active?.id ? preferredAsset?.id : ''}
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

          <details className="wallet-fold phantom-fold" ref={activityRef}>
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

          <details className="wallet-fold wallet-settings phantom-fold" ref={settingsRef}>
            <summary>Wallet settings<ChevronDown size={16} aria-hidden="true" /></summary>
            <div className="wallet-fold-body wallet-settings-grid">
              <section aria-label="Sign-in and keys">
                <h3>Sign-in methods</h3>
                {signedIn ? <LinkedLogins /> : <p className="quiet">Sign in to link email, Google, GitHub, or Discord.</p>}
                <h3>Recovery &amp; keys</h3>
                <PrivyKeyButton
                  key={active?.id || 'empty'}
                  signedIn={signedIn}
                  address={active?.address || glance.address}
                  walletId={exportWalletIdForSheet(activeRaw)}
                  ownerId={ownerId}
                  getAccessToken={getAccessToken}
                />
              </section>
              <section aria-label="Manage wallets">
                <h3>Manage wallets</h3>
                {signedIn ? (
                  <WalletAdd getAccessToken={getAccessToken} ownerId={ownerId} onCreated={onWalletCreated} />
                ) : <p className="quiet">Sign in to create or import a wallet.</p>}
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
                      if (result?.ok && walletId === row.id) {
                        setWalletId('');
                      }
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

function ConnectedPortfolio({ open, previewPortfolio = null, onRetire = null, onCreated = null }) {
  const { user, getAccessToken, unlinkWallet, ready, authenticated } = usePrivy();
  const [portfolio, setPortfolio] = useState(null);
  const [error, setError] = useState('');
  const { linkWallet } = useLinkAccount({
    onSuccess: (userResult, linkMethod, linkedAccount) => {
      const address = linkedAccount?.address || userResult?.linkedAccounts?.slice(-1)[0]?.address;
      if (address) {
        onCreated?.({ id: linkedAccount?.id || `wallet_${address}`, address, kind: 'additional' });
      }
    },
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
        const enriched = await enrichPortfolio(body, {
          userId: user?.id,
          storage: window.localStorage,
        }).catch(() => ({ portfolio: body }));
        if (!stopped) {
          rememberPortfolio(cacheKey, enriched.portfolio);
          setPortfolio(enriched.portfolio);
          setLoading(false);
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
      if (onRetire) {
        const result = await onRetire({ id: `wallet_${address}`, address, kind: 'additional' });
        if (result && result.ok === false) {
          setError(result.message || 'Could not unlink that wallet.');
          return;
        }
      } else {
        await unlinkWallet(address);
      }
    } catch {
      setError('Could not unlink that wallet.');
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

export function WalletAdd({ getAccessToken = null, ownerId = '', onCreated = null }) {
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
    onSuccess: (userResult, linkMethod, linkedAccount) => {
      if (!connecting.current) return;
      connecting.current = false;
      const address = linkedAccount?.address
        || userResult?.linkedAccounts?.slice(-1)[0]?.address
        || user?.linkedAccounts?.slice(-1)[0]?.address;
      if (address) {
        onCreated?.({
          id: linkedAccount?.id || `wallet_${address}`,
          address,
          kind: 'additional',
          label: linkedAccount?.walletClientType ? `${linkedAccount.walletClientType}` : 'Wallet',
        });
      }
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
    <div className="wallet-add phantom-wallet-add">
      <button
        type="button"
        className="wallet-add-connect phantom-connect-btn"
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
            const headersFor = (token) => ({
              'content-type': 'application/json',
              authorization: `Bearer ${token}`,
              ...(ownerId ? { 'x-owner-id': ownerId } : {}),
            });
            const created = (wallet) => {
              if (wallet) onCreated?.(wallet);
              finish('New wallet created. Maelstrom does not store its key.');
            };
            (async () => {
              const token = await getAccessToken?.();
              if (!token) {
                finish('Sign in again, then create a wallet.');
                return;
              }
              const headers = headersFor(token);
              const response = await fetch('/api/wallets/additional', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                  label: `Additional ${count + 1}`,
                  idempotencyKey: `add${Date.now().toString(36)}`.slice(0, 80),
                }),
              });
              const body = await response.json().catch(() => ({}));
              if (response.ok && body.wallet?.address) {
                created(body.wallet);
                return;
              }
              if (body.error === 'main_wallet_required') {
                const provision = await fetch('/api/wallets', { method: 'POST', headers });
                const made = await provision.json().catch(() => ({}));
                if (provision.ok && Array.isArray(made.wallets) && made.wallets[0]?.address) {
                  created(made.wallets);
                  return;
                }
              }
              const options = embeddedCreateOptions(Math.max(count, 1));
              await createWallet(options);
              created(null);
            })().catch(() => finish('That wallet was not created.'));
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
    <div className="wallet-roster phantom-roster" role="list" aria-label="Wallets">
      {rows.map(row => (
        <div key={row.id} className={`wallet-roster-row phantom-roster-row${activeId === row.id ? ' is-on' : ''}`}>
          <button
            type="button"
            className="wallet-roster-pick phantom-roster-pick"
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
              {retiring === row.id ? 'Unlinking' : 'Unlink'}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function WalletPick({ rows, wallets = [], handle = '', activeId, onSelect }) {
  const name = typeof handle === 'string' ? handle.trim().replace(/^@/, '') : '';
  if (!rows.length) return <p className="quiet">No wallet on this account yet. Connect one in settings, or generate a new one.</p>;
  return (
    <div className="wallet-pick-wrap">
      <GlideSelect
        className="wallet-pick"
        ariaLabel="Wallet"
        size="md"
        menuWidth={420}
        accentColor="#ffffff"
        surfaceColor="#111111"
        highlightColor="#1e1e1e"
        textColor="#ffffff"
        value={activeId}
        options={rows.map(row => ({
          value: row.id,
          label: walletPickLabel(row, name),
          tag: walletPickTag(row, wallets.find(wallet => wallet.id === row.id)),
        }))}
        onChange={onSelect}
      />
    </div>
  );
}

function WalletConnection({ wallet }) {
  const { wallets } = useWallets();
  const { connectWallet } = useConnectWallet();
  const connected = wallets.some(item => item.address === wallet.address);
  return (
    <div className="wallet-form phantom-card-inset">
      <p className="quiet">{wallet.label} approves sends and swaps in its own wallet prompt.</p>
      {!connected ? (
        <button type="button" className="ghost" disabled={wallet.frozen} onClick={() => connectWallet(walletConnectionOptions(wallet))}>
          Connect {wallet.label}
        </button>
      ) : null}
    </div>
  );
}

function SendPane({
  active,
  destinations = [],
  tokens,
  preferredAsset = '',
  frozen,
  observing = false,
  onSend,
  onReceipt,
  resolveRecipient = null,
}) {
  const [to, setTo] = useState('');
  const [pickedId, setPickedId] = useState('');
  const [amount, setAmount] = useState('');
  const [assetId, setAssetId] = useState(preferredAsset);
  const [status, setStatus] = useState('');
  const [sendComplete, setSendComplete] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [folded, setFolded] = useState(false);

  useEffect(() => {
    if (!tokens.some(token => token.id === assetId)) {
      setAssetId(tokens[0]?.id || '');
      setAmount('');
    }
  }, [tokens, assetId]);
  useEffect(() => { if (preferredAsset) { setAssetId(preferredAsset); setAmount(''); } }, [preferredAsset]);

  const asset = tokens.find(token => token.id === assetId) || tokens[0] || null;
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

  const walletReady = target?.kind === 'wallet' && !target.frozen;
  const handleReady = target?.kind === 'handle' && !handleLooking && sendHandleReady(handleRecipient);
  const destinationAddress = target?.kind === 'wallet' || target?.kind === 'address'
    ? target.address : target?.kind === 'sns' ? snsAddress : handleReady ? handleRecipient.address : '';
  const enough = asset && units && BigInt(units) <= BigInt(asset.amount);
  const ready = Boolean(
    active && !frozen && target && enough && destinationAddress && destinationAddress !== active.address
    && (
      walletReady
      || handleReady
      || (target.kind === 'sns' && snsAddress)
      || target.kind === 'address'
    )
  );
  const destination = target?.kind === 'wallet'
    ? target.caption
    : target?.kind === 'handle'
      ? `@${target.handle}`
      : target?.kind === 'sns'
        ? (snsAddress || target.domain)
        : target?.kind === 'address' ? target.address : '';
  const preview = ready ? sendPreview({
    from: active?.label || 'Agent wallet',
    to: destination,
    amountLabel: `${amount.trim()} ${asset.symbol}`,
  }) : null;

  return (
    <form className="wallet-form field phantom-send-form" onSubmit={event => event.preventDefault()}>
      <p className="quiet phantom-instruction sr-only">
        {active ? `From ${active.label}.` : 'No wallet yet.'} {observing ? 'A slide opens this wallet’s approval prompt. Nothing sends without its approval.' : 'A slide confirms the send. Nothing is signed before that.'}
      </p>
      {frozen ? <p className="quiet" role="status">This wallet is frozen.</p> : null}

      <div className="phantom-input-card">
        <label className="phantom-field-label">Recipient</label>
        <SendToField
          value={to}
          destinations={destinations}
          selectedId={picked?.id || ''}
          onChange={(next) => { setTo(next); setStatus(''); setFolded(false); }}
          onPick={(row) => setPickedId(row?.id || '')}
        />
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
          <p className="quiet" role="status">{targetHint(target)}</p>
        ) : (
          <p className="quiet">{targetHint(target)}</p>
        )}
      </div>

      <div className="phantom-input-card">
        <div className="phantom-card-row">
          <label className="phantom-field-label">Amount</label>
          {asset ? (
            <button
              type="button"
              className="phantom-max-btn"
              onClick={() => {
                setAmount(formatAmount(asset.amount, asset.decimals));
                setStatus('');
                setFolded(false);
              }}
            >
              MAX
            </button>
          ) : null}
        </div>
        <div className="phantom-amount-row">
          <input
            className="phantom-amount-input"
            value={amount}
            inputMode="decimal"
            placeholder="0.00"
            onChange={event => { setAmount(event.target.value); setStatus(''); setFolded(false); }}
          />
          <div className="phantom-asset-select-wrap">
            <GlideSelect
              ariaLabel="Asset"
              value={asset?.id || ''}
              options={tokens.map(token => ({
                value: token.id,
                label: `${token.symbol}`,
                tag: `${formatAmount(token.amount, token.decimals)}`,
              }))}
              onChange={id => { setAssetId(id); setAmount(''); setStatus(''); setFolded(false); }}
            />
          </div>
        </div>
        {!asset ? (
          <p className="quiet" role="status">No sendable balance loaded for this wallet.</p>
        ) : (
          <p className="quiet phantom-avail">
            Balance: {formatAmount(asset.amount, asset.decimals)} {asset.symbol}
          </p>
        )}
        {asset && units && !enough ? <p className="quiet phantom-error-text" role="status">Amount exceeds this wallet’s balance.</p> : null}
      </div>

      <TxnPreview preview={preview} folded={folded} onToggle={() => setFolded(false)} />

      <SlideCommit
        label="Slide to send"
        doneLabel={sendComplete ? 'Sent' : 'Sending'}
        disabled={!ready}
        resetKey={`${resetKey}:${to}:${amount}:${asset?.id || ''}`}
        onCommit={() => {
          setSendComplete(false);
          const pending = {
            target,
            walletAsset: asset.id,
            destination: destinationAddress,
            decimals: asset.decimals,
            fromWalletId: active.id,
            amount: units,
            asset: asset.symbol,
            amountText: amount.trim(),
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

function targetHint(target) {
  if (!target) return 'Type a @handle, .sol name, or Solana address, or pick a wallet.';
  if (target.kind === 'sns') return `Looking up ${target.domain}.`;
  if (target.kind === 'wallet') return `Sends the selected asset to ${target.caption}.`;
  if (target.kind === 'invalid-address') return 'That address is not a valid Solana pubkey.';
  return target.kind === 'address' ? 'Sends directly. Check the recipient address.' : '';
}

function ReceivePane({ active, handle }) {
  const display = handle ? (handle.startsWith('@') ? handle : `@${handle}`) : '';

  return (
    <div className="wallet-form phantom-receive-card">
      <p className="quiet phantom-receive-hint">Share your @handle or address to receive funds.</p>
      {display ? (
        <p className="wallet-handle phantom-receive-handle">{display}</p>
      ) : (
        <p className="quiet">Claim a @handle to get paid by name.</p>
      )}

      <div className="phantom-receive-address-box">
        <AddressCopy address={active?.address || ''} />
      </div>

      <p className="quiet phantom-network-note">
        This address can only receive Solana and SPL tokens.
      </p>
    </div>
  );
}
