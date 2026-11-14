'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import MoneyPane from './MoneyPane';
import { usePresence } from './usePresence';

export default function WalletsSheet({ open, onClose, state, note = '', signedIn = false, onSignIn = null }) {
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
        className="sheet wallets-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallets-title"
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="sheet-head">
          <h2 id="wallets-title">Wallets</h2>
          <button type="button" className="icon-btn" aria-label="Close wallets" onClick={onClose}>
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>
        {note ? <p className="preview-note">{note}</p> : null}
        <MoneyPane pane="wallets" state={state} signedIn={signedIn} onSignIn={onSignIn} />
      </section>
    </div>
  );
}
