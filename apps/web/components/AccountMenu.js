'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BrainCircuit, ChartColumn, Lock, LockOpen, LogOut, Monitor, Plug, ScrollText, Shield, UserRound, Wallet } from 'lucide-react';
import { markSeenLogin } from '../lib/seen-login.mjs';
import ProfileMark from './ProfileMark';
import SpecularButton from './SpecularButton';
import { accountMenuPlacement } from '../lib/account-menu-placement.mjs';

const ITEMS = [
  { id: 'profile', label: 'Profile', icon: UserRound },
  { id: 'statistics', label: 'Statistics', icon: ChartColumn },
  { id: 'wallet', label: 'Wallet', icon: Wallet },
  { id: 'plugins', label: 'Plugins', icon: Plug },
  { id: 'ai-providers', label: 'AI Providers', icon: BrainCircuit },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'logs', label: 'Logs', icon: ScrollText },
  { id: 'computer', label: 'Computer', icon: Monitor },
];

export default function AccountMenu({ accountLabel, avatarUrl = null, collapsed = false, signedIn = false, loginDisabled = false, walletUnlocked = false, walletLockAvailable = false, holdingsLabel = '', onLogin, onPick }) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState({});
  const rootRef = useRef(null);
  const triggerRef = useRef(null);

  useLayoutEffect(() => {
    if (!open) return undefined;
    function placeMenu() {
      const rect = rootRef.current?.getBoundingClientRect();
      if (rect) setPlacement(accountMenuPlacement(rect, window.innerHeight));
    }
    placeMenu();
    window.addEventListener('resize', placeMenu);
    window.addEventListener('scroll', placeMenu, true);
    return () => {
      window.removeEventListener('resize', placeMenu);
      window.removeEventListener('scroll', placeMenu, true);
    };
  }, [open]);

  function closeMenu() {
    const pop = rootRef.current?.querySelector('.account-pop');
    const active = typeof document === 'undefined' ? null : document.activeElement;
    if (active && pop?.contains(active)) triggerRef.current?.focus();
    setOpen(false);
  }

  useEffect(() => {
    if (signedIn) markSeenLogin(window.localStorage);
  }, [signedIn]);

  useEffect(() => {
    if (!open) return undefined;
    function onPointer(event) {
      if (!rootRef.current?.contains(event.target)) closeMenu();
    }
    function onKey(event) {
      if (event.key === 'Escape') closeMenu();
    }
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!signedIn) {
    return (
      <div className="sign-up-slot">
        <SpecularButton size="sm" radius={999} disabled={loginDisabled} onClick={() => onLogin?.()}>
          Continue
        </SpecularButton>
      </div>
    );
  }

  const walletAction = walletUnlocked
    ? { id: 'lock-wallet', label: 'Lock wallet', icon: Lock }
    : { id: 'unlock-wallet', label: 'Unlock wallet', icon: LockOpen };
  return (
    <div className={`account-menu${open ? ' is-open' : ''}`} ref={rootRef}>
      <div className="account-pop" style={placement} role="menu" aria-label="Account" inert={open ? undefined : true}>
        {[...ITEMS, ...(walletLockAvailable ? [walletAction] : []), { id: 'logout', label: 'Log out', icon: LogOut }].map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="account-item"
              tabIndex={open ? 0 : -1}
              onClick={() => {
                triggerRef.current?.focus();
                setOpen(false);
                onPick(item.id);
              }}
            >
              <Icon size={16} strokeWidth={1.75} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
      <div className="you-row">
        <button
          type="button"
          className="you-id"
          aria-label={accountLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          ref={triggerRef}
          onClick={() => (open ? closeMenu() : setOpen(true))}
        >
          <ProfileMark src={avatarUrl} label={accountLabel} className="you-mark is-round" />
          {collapsed ? null : <strong>{accountLabel}</strong>}
          {/* Assigned wallet mainnet-beta SOL and USDC when the chain read is in. Otherwise the shared USDC book. */}
          {collapsed || !holdingsLabel ? null : <span className="you-holdings">{holdingsLabel}</span>}
        </button>
      </div>
    </div>
  );
}
