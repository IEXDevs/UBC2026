'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { saveProvider } from '../lib/provider-tokens.mjs';

const EMPTY = { name: '', token: '', baseUrl: '' };

function noteFor(reason) {
  if (reason === 'url') return 'Use an https provider URL.';
  if (reason === 'name') return 'Use a short provider name.';
  return 'Use a token of at least 8 characters.';
}

export default function ProviderAdd({ open, onClose, onSaved }) {
  const [draft, setDraft] = useState(EMPTY);
  const [note, setNote] = useState('');
  const [root, setRoot] = useState(null);

  useEffect(() => {
    setRoot(document.body);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    setDraft(EMPTY);
    setNote('');
    function onKey(event) {
      if (event.key === 'Escape') onClose?.();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !root) return null;

  function submit(event) {
    event.preventDefault();
    let result;
    try { result = saveProvider(localStorage, draft); }
    catch { setNote('Browser storage is unavailable. Allow storage and try again.'); return; }
    if (!result.ok) {
      setNote(noteFor(result.reason));
      return;
    }
    onSaved?.(result.provider);
    onClose?.();
  }

  return createPortal(
    <div className="backdrop is-center is-provider" onMouseDown={onClose}>
      <form
        className="sheet provider-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-add-title"
        onMouseDown={event => event.stopPropagation()}
        onSubmit={submit}
      >
        <p className="plugin-kicker">Model providers</p>
        <h2 id="provider-add-title">Add API provider</h2>
        <p className="quiet">The token stays on this device. Chat still uses the signed-in model key.</p>
        <label>
          Provider name
          <input aria-label="Provider name" autoFocus required maxLength={41} placeholder="e.g. OpenRouter" value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} />
        </label>
        <label>
          API token
          <input aria-label="API token" type="password" autoComplete="off" required maxLength={256} spellCheck={false} placeholder="Enter API token" value={draft.token} onChange={event => setDraft(current => ({ ...current, token: event.target.value }))} />
        </label>
        <label>
          Base URL (optional)
          <input aria-label="Provider URL" placeholder="https://api.example.com" value={draft.baseUrl} onChange={event => setDraft(current => ({ ...current, baseUrl: event.target.value }))} />
        </label>
        {note ? <p className="voice-note" role="status">{note}</p> : null}
        <div className="provider-modal-actions">
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="solid">Save token</button>
        </div>
      </form>
    </div>,
    root,
  );
}
