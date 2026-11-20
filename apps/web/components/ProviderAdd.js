'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { saveProvider } from '../lib/provider-tokens.mjs';
import { AI_PROVIDERS } from '../lib/ai-provider.mjs';
import { announceModelSettings, forgetProviderModels } from '../lib/provider-models.mjs';

const EMPTY = { name: 'Meta', token: '', baseUrl: AI_PROVIDERS[0].baseUrl };

function noteFor(reason) {
  if (reason === 'url') return 'Use an https provider URL.';
  if (reason === 'name') return 'Use a short provider name.';
  return 'Use a token of at least 8 characters.';
}

export default function ProviderAdd({ open, onClose, onSaved }) {
  const [draft, setDraft] = useState(EMPTY);
  const [note, setNote] = useState('');
  const [root, setRoot] = useState(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    setRoot(document.body);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    setDraft(EMPTY);
    setNote('');
    function onKey(event) {
      if (event.key === 'Escape') close.current?.();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

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
    try { forgetProviderModels(localStorage, result.provider.id); } catch { /* credentials were saved; a check can refresh models */ }
    announceModelSettings();
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
        <p className="plugin-kicker">AI Providers</p>
        <h2 id="provider-add-title">Add AI provider</h2>
        <p className="quiet">Save a key, then check which chat models it offers. Your key is stored only in this browser and sent securely when checking models or chatting. Usage is billed by your provider.</p>
        <label>
          AI provider
          <select aria-label="AI provider" value={draft.baseUrl} onChange={event => {
            const item = AI_PROVIDERS.find(provider => provider.baseUrl === event.target.value);
            setDraft(current => ({ ...current, baseUrl: item.baseUrl, name: item.name }));
          }}>
            {AI_PROVIDERS.map(provider => <option key={provider.baseUrl} value={provider.baseUrl}>{provider.name}</option>)}
          </select>
        </label>
        <label>
          Provider name
          <input aria-label="Provider name" autoFocus required maxLength={41} placeholder="e.g. OpenRouter" value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} />
        </label>
        <label>
          API token
          <input aria-label="API token" type="password" autoComplete="off" required maxLength={256} spellCheck={false} placeholder="Enter API token" value={draft.token} onChange={event => setDraft(current => ({ ...current, token: event.target.value }))} />
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
