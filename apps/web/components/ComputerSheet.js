'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import LiveViewPanel from './LiveViewPanel';
import { usePresence } from './usePresence';

export default function ComputerSheet({ open, onClose, bot, ownerId = null }) {
  const { mounted, leaving } = usePresence(open, 180);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!mounted) {
      setShown(false);
      return undefined;
    }
    const frame = requestAnimationFrame(() => setShown(true));
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey);
    };
  }, [mounted, onClose]);

  if (!mounted || !bot || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={`browser-preview${shown && !leaving ? ' is-open' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`${bot.name} computer`}
      onMouseDown={onClose}
    >
      <button type="button" className="browser-preview-close" aria-label="Close computer" onMouseDown={event => event.stopPropagation()} onClick={onClose}>
        <X size={18} strokeWidth={1.75} />
      </button>
      <div className="browser-preview-stage" onMouseDown={event => event.stopPropagation()}>
        <LiveViewPanel botId={bot.id} ownerId={ownerId} fill />
      </div>
    </div>,
    document.body,
  );
}
