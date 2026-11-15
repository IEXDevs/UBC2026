'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import AccountStats from './AccountStats';
import { profileStats } from '../lib/statistics.mjs';
import { motion } from 'motion/react';
import { normalizeDisplayName, normalizeHandle } from '@ubc2026/contracts';
import AddressCopy from './AddressCopy';
import ProfileMark from './ProfileMark';
import LinkedLogins from './LinkedLogins';
import { usePresence } from './usePresence';

export default function ProfileSheet({
  open,
  onClose,
  accountLabel,
  avatarUrl = null,
  profile = null,
  glance,
  wallets,
  voiceMs = 0,
  talks = {},
  payments = [],
  transfers = [],
  signedIn,
  loginDisabled,
  onLogin,
  onLogout,
  onSave,
}) {
  const { mounted, leaving } = usePresence(open);
  const [displayName, setDisplayName] = useState(profile?.displayName || accountLabel || '');
  const [handle, setHandle] = useState(profile?.handle || '');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    setDisplayName(profile?.displayName || accountLabel || '');
    setHandle(profile?.handle || '');
    setNote('');
  }, [open, profile, accountLabel]);

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
    <div className={`backdrop is-center ${leaving ? 'is-leaving' : ''}`} onMouseDown={onClose}>
      <motion.section
        className="profile-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-title"
        onMouseDown={event => event.stopPropagation()}
        initial={leaving ? false : { opacity: 0, y: 36, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="profile-identity">
          <div className="sheet-head">
            <p className="plugin-kicker">Account</p>
            <button type="button" className="icon-btn" aria-label="Close settings" onClick={onClose}>
              <X size={18} strokeWidth={1.75} />
            </button>
          </div>
          <ProfileMark src={avatarUrl || profile?.avatarUrl} label={displayName || accountLabel} className="you-mark is-huge" />
          <h2 id="profile-title">{displayName || accountLabel}</h2>
          <p className="profile-handle">{handle ? `@${handle}` : 'No handle yet'}</p>
          {signedIn ? (
            <form
              className="field profile-form"
              onSubmit={(event) => {
                event.preventDefault();
                const nextName = normalizeDisplayName(displayName);
                const nextHandle = normalizeHandle(handle);
                if (!nextName || !nextHandle) {
                  setNote('Use a display name and a handle like alex. Letters, numbers, and underscores.');
                  return;
                }
                Promise.resolve(onSave?.({
                  displayName: nextName,
                  handle: nextHandle,
                  avatarUrl: avatarUrl || profile?.avatarUrl || null,
                })).then((saved) => {
                  setNote(saved?.error === 'handle_taken' ? 'That handle is already taken.' : 'Saved.');
                }).catch(() => {
                  setNote('Saved on this device. The directory did not update.');
                });
              }}
            >
              <label>
                Display name
                <input value={displayName} maxLength={64} onChange={event => setDisplayName(event.target.value)} />
              </label>
              <label>
                Handle
                <input
                  value={handle}
                  maxLength={32}
                  spellCheck={false}
                  autoCapitalize="none"
                  placeholder="alex"
                  onChange={event => setHandle(event.target.value.replace(/^@/, ''))}
                />
              </label>
              <p className="quiet">@{handle || 'alex'} pays this account. @richclub.sol goes through SNS, not this directory.</p>
              {note ? <p className="voice-note" role="status">{note}</p> : null}
              <button type="submit" className="solid">Save profile</button>
            </form>
          ) : (
            <button type="button" className="solid" disabled={loginDisabled} onClick={onLogin}>Connect</button>
          )}
        </div>
        <div className="profile-settings">
          <p className="plugin-kicker">Stats</p>
          <AccountStats rows={profileStats({ voiceMs, talks, payments, transfers })} />
          <p className="quiet">Talk time is seconds on this device. Net PnL is inflows minus outflows. devnet execution, mainnet pricing.</p>
          <p className="plugin-kicker">Wallet</p>
          {signedIn ? (
            <>
              <p className="profile-balance">{wallets?.length ? glance.balanceLabel : 'No wallet'}</p>
              <p className="quiet">{wallets?.length ? glance.label : 'Sign-in provisions the main Privy wallet'}</p>
              <AddressCopy address={glance.address} />
              <p className="quiet">Balance is from live positions when bots open them. devnet execution, mainnet pricing.</p>
              <ul className="profile-wallets">
                {(wallets || []).map(wallet => (
                  <li key={wallet.id}>
                    <strong>{wallet.label}</strong>
                    <AddressCopy address={wallet.address} />
                  </li>
                ))}
              </ul>
              <LinkedLogins />
            </>
          ) : (
            <>
              <p className="profile-balance">Not signed in</p>
              <p className="quiet">Connect to see your Privy wallets. No preview rows are shown while signed out.</p>
            </>
          )}
          {signedIn ? (
            <button type="button" className="ghost" onClick={onLogout}>Log out</button>
          ) : null}
        </div>
      </motion.section>
    </div>
  );
}
