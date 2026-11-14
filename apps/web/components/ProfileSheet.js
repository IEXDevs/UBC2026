'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { usePresence } from './usePresence';

export default function ProfileSheet({
  open,
  onClose,
  accountLabel,
  glance,
  wallets,
  signedIn,
  loginDisabled,
  onLogin,
  onLogout,
}) {
  const { mounted, leaving } = usePresence(open);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <div className={`backdrop is-corner ${leaving ? 'is-leaving' : ''}`} onMouseDown={onClose}>
      <section
        className="sheet profile-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-title"
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="sheet-head">
          <h2 id="profile-title">{accountLabel}</h2>
          <button type="button" className="icon-btn" aria-label="Close settings" onClick={onClose}>
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>
        <p className="glance-line">
          <span>{glance.label}</span>
          <strong>{glance.balanceLabel}</strong>
        </p>
        <p className="quiet">{glance.address || 'No wallet yet'}</p>
        <p className="preview-note">Preview balance. A live wallet read is not connected yet.</p>
        <ul className="quiet-list">
          {wallets.map(wallet => (
            <li key={wallet.id}>
              <strong>{wallet.label}</strong>
              <small>{wallet.address}</small>
            </li>
          ))}
        </ul>
        <div className="sheet-actions">
          {signedIn ? (
            <button type="button" className="ghost" onClick={onLogout}>Log out</button>
          ) : (
            <button type="button" className="solid" disabled={loginDisabled} onClick={onLogin}>Connect</button>
          )}
        </div>
      </section>
    </div>
  );
}
