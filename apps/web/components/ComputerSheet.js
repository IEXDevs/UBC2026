'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import LiveViewPanel from './LiveViewPanel';
import { usePresence } from './usePresence';

export default function ComputerSheet({ open, onClose, bot, ownerId = null }) {
  const { mounted, leaving } = usePresence(open);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mounted || !bot) return null;

  return (
    <div className={`backdrop is-center ${leaving ? 'is-leaving' : ''}`} onMouseDown={onClose}>
      <section
        className="computer-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="computer-title"
        onMouseDown={event => event.stopPropagation()}
      >
        <header>
          <h2 id="computer-title">{bot.name}</h2>
          <button type="button" className="icon-btn" aria-label="Close computer" onClick={onClose}>
            <X size={18} strokeWidth={1.75} />
          </button>
        </header>
        <LiveViewPanel botId={bot.id} ownerId={ownerId} />
      </section>
    </div>
  );
}
