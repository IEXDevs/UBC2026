'use client';

import { useState } from 'react';
import { useLinkAccount, usePrivy } from '@privy-io/react-auth';
import { describeLoginMethods } from '../lib/privy-config.mjs';

export default function LinkedLogins() {
  const { user, ready, authenticated } = usePrivy();
  const [note, setNote] = useState('');
  const { linkEmail, linkGoogle, linkGithub, linkDiscord } = useLinkAccount({
    onError: () => {
      setNote('That sign-in method could not be linked. If it already belongs to another account, sign in with it instead.');
    },
  });
  const described = describeLoginMethods(user);
  const actions = {
    email: linkEmail,
    google: linkGoogle,
    github: linkGithub,
    discord: linkDiscord,
  };
  const linked = described.methods.filter(method => method.linked);
  const open = described.methods.filter(method => !method.linked);

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
      <p className="quiet">Email, Google, GitHub, and Discord sign into this same account.</p>
      {linked.length ? (
        <ul className="profile-wallets">
          {linked.map(method => (
            <li key={method.id}>
              <strong>{method.label}</strong>
              <span>{method.detail || 'Linked'}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {open.length ? (
        <div className="wallet-switch">
          {open.map(method => (
            <button key={method.id} type="button" onClick={() => addMethod(method.id)}>
              Link {method.label}
            </button>
          ))}
        </div>
      ) : null}
      {note ? <p className="quiet" role="status">{note}</p> : null}
    </div>
  );
}
