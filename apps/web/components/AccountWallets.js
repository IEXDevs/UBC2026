'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { WalletAdd } from './WalletsSheet';
import AddressCopy from './AddressCopy';
import { usePresence } from './usePresence';

export default function AccountWallets({
  open,
  onClose,
  glance,
  wallets = [],
  signedIn = false,
  privyLive = false,
  onDesk,
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
    <div className={`backdrop is-center ${leaving ? 'is-leaving' : ''}`} onMouseDown={onClose}>
      <section
        className="account-wallets"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-wallets-title"
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="stats-head">
          <h2 id="account-wallets-title">Wallets</h2>
          <button type="button" className="icon-btn" aria-label="Close wallets" onClick={onClose}>
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>
        {signedIn ? (
          <>
            <p className="profile-balance">{wallets.length ? glance?.balanceLabel : 'No wallet'}</p>
            <p className="stats-note">Devnet SOL and USDC on this account. devnet execution, mainnet pricing.</p>
            {wallets.length ? (
              <ul className="profile-wallets">
                {wallets.map(wallet => (
                  <li key={wallet.id}>
                    <span className="profile-wallet-name">{wallet.label}</span>
                    <span>{wallet.kind === 'main' ? 'Main' : 'Additional'}</span>
                    <AddressCopy address={wallet.address} compact />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="quiet">No wallet on this account yet.</p>
            )}
            {privyLive ? <WalletAdd /> : <p className="quiet">Sign in to add a wallet.</p>}
            <button type="button" className="ghost" onClick={onDesk}>Send and history</button>
          </>
        ) : (
          <>
            <p className="profile-balance">Not signed in</p>
            <p className="stats-note">Connect to see your Privy wallets.</p>
          </>
        )}
      </section>
    </div>
  );
}
