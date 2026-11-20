'use client';

import { useState } from 'react';
import { useLinkAccount, usePrivy } from '@privy-io/react-auth';
import { Check, Link2 } from 'lucide-react';
import { describeLoginMethods } from '../lib/privy-config.mjs';

export default function ProfileConnections({ user = null, onLink, note = '' }) {
  const methods = describeLoginMethods(user).methods.filter(method => method.id === 'github' || method.id === 'discord');
  return <div className="profile-connections">
    <p className="plugin-kicker">Linked accounts</p>
    {methods.map(method => <div className="profile-connection" key={method.id}>
      <div><strong>{method.label}</strong><span>{method.linked ? method.detail || 'Connected' : 'Not linked'}</span></div>
      {method.linked ? <span className="profile-linked"><Check size={14} />Linked</span>
        : <button type="button" className="ghost" disabled={!onLink} title={!onLink ? `Sign in to link ${method.label}` : undefined} aria-label={`Link ${method.label}`} onClick={() => onLink?.(method.id)}><Link2 size={14} />Link</button>}
    </div>)}
    {note ? <p className="voice-note" role="status">{note}</p> : null}
  </div>;
}

export function LiveProfileConnections() {
  const { user, ready, authenticated } = usePrivy();
  const [note, setNote] = useState('');
  const { linkGithub, linkDiscord } = useLinkAccount({
    onError: () => setNote('That sign-in method could not be linked. If it belongs to another account, sign in with it instead.'),
  });
  function link(id) {
    setNote('');
    try {
      const action = id === 'github' ? linkGithub : linkDiscord;
      Promise.resolve(action()).catch(() => setNote('Could not link that account. Try again.'));
    } catch { setNote('Could not link that account. Try again.'); }
  }
  return <ProfileConnections user={user} onLink={ready && authenticated ? link : undefined} note={note} />;
}
