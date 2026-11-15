'use client';

import { useState } from 'react';
import { useLinkAccount, usePrivy } from '@privy-io/react-auth';
import { describeLoginMethods } from '../lib/privy-config.mjs';
import AddressCopy from './AddressCopy';

const CLIENT_LABELS = {
  phantom: 'Phantom',
  solflare: 'Solflare',
  backpack: 'Backpack',
  jupiter: 'Jupiter',
  privy: 'Privy',
};

function clientLabel(client) {
  return CLIENT_LABELS[client] || 'Wallet';
}

export default function LinkedLogins() {
  const { user, ready, authenticated } = usePrivy();
  const { linkEmail, linkGoogle, linkGithub, linkDiscord, linkWallet } = useLinkAccount();
  const [note, setNote] = useState('');
  const described = describeLoginMethods(user);
  const actions = {
    email: linkEmail,
    google: linkGoogle,
    github: linkGithub,
    discord: linkDiscord,
  };

  function addWallet() {
    setNote('');
    if (!ready || !authenticated) {
      setNote('Sign in again, then add the wallet.');
      return;
    }
    linkWallet({ walletChainType: 'solana-only' });
  }

  function addMethod(id) {
    setNote('');
    if (!ready || !authenticated) {
      setNote('Sign in again, then link that method.');
      return;
    }
    const action = actions[id];
    if (!action) return;
    try {
      action();
    } catch {
      setNote('That sign-in method could not be linked. If it already belongs to another account, sign in with it instead.');
    }
  }

  return (
    <div className="linked-logins">
      <p className="plugin-kicker">Sign-in</p>
      <p className="quiet">
        Email, Google, GitHub, Discord, and every wallet you add all sign into this same account.
        Add as many Solana wallets as you need.
      </p>
      <ul className="profile-wallets">
        {described.wallets.map(wallet => (
          <li key={wallet.address}>
            <strong>{clientLabel(wallet.client)}</strong>
            <AddressCopy address={wallet.address} />
          </li>
        ))}
        {described.methods.filter(method => method.linked).map(method => (
          <li key={method.id}>
            <strong>{method.label}</strong>
            <span>{method.detail || 'Linked'}</span>
          </li>
        ))}
      </ul>
      <div className="wallet-switch">
        <button type="button" onClick={addWallet}>Add a wallet</button>
        {described.methods.filter(method => !method.linked).map(method => (
          <button key={method.id} type="button" onClick={() => addMethod(method.id)}>
            Link {method.label}
          </button>
        ))}
      </div>
      {note ? <p className="quiet" role="status">{note}</p> : null}
    </div>
  );
}
