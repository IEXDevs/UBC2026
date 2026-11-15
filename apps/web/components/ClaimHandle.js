'use client';

import { useState } from 'react';
import { normalizeDisplayName, normalizeHandle } from '@ubc2026/contracts';

export default function ClaimHandle({ accountLabel = '', onSave }) {
  const [displayName, setDisplayName] = useState(accountLabel || '');
  const [handle, setHandle] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);

  return (
    <div className="backdrop is-center">
      <section className="sheet wallet-gate" role="dialog" aria-modal="true" aria-labelledby="claim-title">
        <h2 id="claim-title">Claim your @handle</h2>
        <p className="quiet">Every account needs a handle before the wallet opens. People pay @{handle || 'you'} on Maelstrom. A .sol name is separate and is not this claim.</p>
        <form
          className="field"
          onSubmit={(event) => {
            event.preventDefault();
            const nextName = normalizeDisplayName(displayName);
            const nextHandle = normalizeHandle(handle);
            if (!nextName || !nextHandle) {
              setNote('Use a display name and a handle like alex. Letters, numbers, and underscores.');
              return;
            }
            setPending(true);
            Promise.resolve(onSave?.({
              displayName: nextName,
              handle: nextHandle,
            })).then((saved) => {
              if (saved?.error === 'handle_taken') {
                setNote('That handle is already taken.');
                setPending(false);
                return;
              }
              setNote('');
            }).catch(() => {
              setNote('The directory did not update. Try the claim again.');
              setPending(false);
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
          {note ? <p className="quiet" role="status">{note}</p> : null}
          <button type="submit" className="solid" disabled={pending}>{pending ? 'Claiming…' : 'Claim handle'}</button>
        </form>
      </section>
    </div>
  );
}
