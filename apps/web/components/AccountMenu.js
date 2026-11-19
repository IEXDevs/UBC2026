'use client';

import { useEffect, useRef, useState } from 'react';
import { ChartColumn, Lock, Monitor, Plug, ScrollText, Shield, UserRound, Wallet } from 'lucide-react';
import { markSeenLogin } from '../lib/seen-login.mjs';
import ProfileMark from './ProfileMark';
import SpecularButton from './SpecularButton';

const ITEMS = [
  { id: 'profile', label: 'Profile', icon: UserRound },
  { id: 'statistics', label: 'Statistics', icon: ChartColumn },
  { id: 'wallet', label: 'Wallet', icon: Wallet },
  { id: 'plugins', label: 'Plugins', icon: Plug },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'logs', label: 'Logs', icon: ScrollText },
  { id: 'computer', label: 'Computer', icon: Monitor },
];

export default function AccountMenu({ accountLabel, avatarUrl = null, collapsed = false, signedIn = false, loginDisabled = false, walletUnlocked = false, onLogin, onPick }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (signedIn) markSeenLogin(window.localStorage);
  }, [signedIn]);

  useEffect(() => {
    if (!open) return undefined;
    function onPointer(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key === 'Escape') setOpen(false);
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

  return (
    <div className={`account-menu${open ? ' is-open' : ''}`} ref={rootRef}>
      <div className="account-pop" role="menu" aria-label="Account" aria-hidden={!open}>
        {[...ITEMS, ...(walletUnlocked ? [{ id: 'lock-wallet', label: 'Lock wallet', icon: Lock }] : [])].map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="account-item"
              tabIndex={open ? 0 : -1}
              onClick={() => {
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
          onClick={() => setOpen(value => !value)}
        >
          <ProfileMark src={avatarUrl} label={accountLabel} className="you-mark is-round" />
          {collapsed ? null : <strong>{accountLabel}</strong>}
        </button>
      </div>
    </div>
  );
}
