'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import ConnectorsPane from './ConnectorsPane';
import { usePresence } from './usePresence';

export default function PluginsSheet({ open, onClose, connectors = [] }) {
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
        className="plugins-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plugins-title"
        onMouseDown={event => event.stopPropagation()}
      >
        <button type="button" className="plugins-close" aria-label="Close plugins" onClick={onClose}>
          <X size={18} strokeWidth={1.75} />
        </button>
        <ConnectorsPane connectors={connectors} />
      </section>
    </div>
  );
}
