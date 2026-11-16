'use client';

import { useState } from 'react';
import { normalizeDisplayName, normalizeHandle } from '@ubc2026/contracts';
import { claimSaveNote, handleAlreadyClaimed } from '../lib/profile.mjs';
import { shellRuntimeUrl } from '../lib/runtime-data.mjs';

export default function ClaimHandle({ accountLabel = '', ownerId = '', onSave }) {
  const [displayName, setDisplayName] = useState(accountLabel || '');
  const [handle, setHandle] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const typed = normalizeHandle(handle);

  return (
    <div className="backdrop is-center">
      <section className="sheet wallet-gate" role="dialog" aria-modal="true" aria-labelledby="claim-title">
        <h2 id="claim-title">Claim your @handle</h2>
        <p className="quiet">{typed ? `Claim your handle to get paid, @${typed}.` : 'Claim your handle to get paid.'}</p>
        <form
          className="field"
          onSubmit={(event) => {
            event.preventDefault();
            const nextName = normalizeDisplayName(displayName);
            const nextHandle = normalizeHandle(handle);
            if (!nextName || !nextHandle) {
              setNote('Use a display name and a handle. Letters, numbers, and underscores.');
              return;
            }
            setPending(true);
            const lookup = ownerId
              ? shellRuntimeUrl(`/api/profiles/lookup?q=${encodeURIComponent(`@${nextHandle}`)}`)
              : null;
            Promise.resolve(lookup ? fetch(lookup, {
              headers: { 'x-owner-id': ownerId },
              cache: 'no-store',
            }) : null).then(async (response) => {
              if (response) {
                const found = await response.json().catch(() => ({}));
                const unchecked = response.status === 503 && found.error === 'runtime_unconfigured';
                if (!unchecked && (!response.ok || handleAlreadyClaimed(found))) {
                  setNote(handleAlreadyClaimed(found) ? 'That handle is already taken.' : 'Could not check that handle.');
                  setPending(false);
                  return null;
                }
              }
              return onSave?.({
                displayName: nextName,
                handle: nextHandle,
              });
            }).then((saved) => {
              if (saved == null) return;
              if (saved?.error || saved?.ok === false) {
                setNote(claimSaveNote(saved));
                setPending(false);
                return;
              }
              setNote('');
            }).catch((error) => {
              setNote(claimSaveNote(error));
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
              placeholder="@handle"
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
