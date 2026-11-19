'use client';

import { useEffect, useRef, useState } from 'react';
import { Wallet } from 'lucide-react';
import { shortAddress } from '../lib/money-views.mjs';
import { WalletAdd } from './WalletsSheet';

function liveWallets(wallets) {
  return (Array.isArray(wallets) ? wallets : []).filter(wallet => wallet && !wallet.deletedAt && !wallet.deleted_at);
}

export default function WalletDock({ privyLive = false, wallets = [], balanceLabel = '', onOpen }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const rows = liveWallets(wallets);

  function close() {
    const panel = panelRef.current;
    const active = typeof document === 'undefined' ? null : document.activeElement;
    if (active && panel?.contains(active)) triggerRef.current?.focus();
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return undefined;
    function onPointer(event) {
      if (!rootRef.current?.contains(event.target)) close();
    }
    function onKey(event) {
      if (event.key === 'Escape') close();
    }
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    panelRef.current?.querySelector('button, a, input, textarea')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={`wallet-dock${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="wallet-mark"
        aria-label="Wallets"
        aria-haspopup="dialog"
        aria-expanded={open}
        ref={triggerRef}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Wallet size={18} strokeWidth={1.75} />
        {rows.length > 0 ? <span className="wallet-mark-count">{rows.length}</span> : null}
      </button>
      {open ? (
        <div className="wallet-pop" role="dialog" aria-label="Wallets" ref={panelRef}>
          <div className="wallet-pop-head">
            <strong>Wallets</strong>
            {balanceLabel ? <span>{balanceLabel}</span> : null}
          </div>
          {rows.length === 0 ? (
            <p className="quiet">No wallet on this account yet.</p>
          ) : (
            <ul className="wallet-pop-list">
              {rows.map(wallet => (
                <li key={wallet.id || wallet.address}>
                  <button type="button" onClick={() => { close(); onOpen?.(wallet.id); }}>
                    <strong>{wallet.label || 'Wallet'}</strong>
                    <span>{wallet.kind === 'main' ? 'Main' : (wallet.spendable === false ? 'Connected' : 'Added')}</span>
                    <em>{shortAddress(wallet.address)}</em>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {privyLive ? <WalletAdd /> : <p className="quiet">Sign in to add a wallet.</p>}
          <button
            type="button"
            className="solid wallet-pop-details"
            onClick={() => { close(); onOpen?.(); }}
          >
            Open wallet details
          </button>
        </div>
      ) : null}
    </div>
  );
}
