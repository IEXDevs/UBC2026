'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import ModelProviders from './ModelProviders';
import { usePresence } from './usePresence';

export default function AIProvidersSheet({ open, onClose }) {
  const { mounted, leaving } = usePresence(open);
  const [root, setRoot] = useState(null);
  const dialog = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => { setRoot(document.body); }, []);
  useEffect(() => {
    if (!open || !root) return undefined;
    const previous = document.activeElement;
    dialog.current?.focus();
    function onKey(event) {
      if (document.querySelector('.is-provider')) return;
      if (event.key === 'Escape') close.current();
      if (event.key === 'Tab') {
        const items = [...(dialog.current?.querySelectorAll('button:not(:disabled), input, select, [tabindex="0"]') || [])];
        const first = items[0];
        const last = items.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); if (previous?.isConnected) previous.focus(); };
  }, [open, root]);
  if (!mounted || !root) return null;
  return createPortal(
    <div className={`backdrop is-center ${leaving ? 'is-leaving' : ''}`} onMouseDown={onClose}>
      <section className="ai-providers-modal" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="ai-providers-title" onMouseDown={event => event.stopPropagation()}>
        <button type="button" className="plugins-close" aria-label="Close AI Providers" onClick={onClose}><X size={18} /></button>
        <ModelProviders />
      </section>
    </div>, root,
  );
}
