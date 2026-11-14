'use client';

import { useEffect, useRef, useState } from 'react';
import { Plug, ScrollText, Shield, UserRound, Wallet } from 'lucide-react';
import ProfileMark from './ProfileMark';

const ITEMS = [
  { id: 'profile', label: 'Profile', icon: UserRound },
  { id: 'wallet', label: 'Wallet', icon: Wallet },
  { id: 'plugins', label: 'Plugins', icon: Plug },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'logs', label: 'Logs', icon: ScrollText },
];

export default function AccountMenu({ accountLabel, hint = 'Account', avatarUrl = null, onPick }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

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

  return (
    <div className={`account-menu${open ? ' is-open' : ''}`} ref={rootRef}>
      <div className="account-pop" role="menu" aria-label="Account" aria-hidden={!open}>
        {ITEMS.map((item) => {
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
      <button
        type="button"
        className="you-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={accountLabel}
        onClick={() => setOpen(value => !value)}
      >
        {avatarUrl ? <ProfileMark src={avatarUrl} label={accountLabel} /> : (
          <span className="you-mark" aria-hidden="true">
            <UserRound size={16} strokeWidth={1.75} />
          </span>
        )}
        <span className="you-copy">
          <strong>{accountLabel}</strong>
          <small>{hint}</small>
        </span>
      </button>
    </div>
  );
}
