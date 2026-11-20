'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import ModalClose from './ModalClose';
import ConnectorsPane from './ConnectorsPane';
import { usePresence } from './usePresence';

export default function PluginsSheet({ open, onClose, connectors = [] }) {
  const { mounted, leaving } = usePresence(open);
  const [root, setRoot] = useState(null);

  useEffect(() => {
    setRoot(document.body);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event) {
      if (event.key === 'Escape' && !document.querySelector('.is-provider')) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mounted || !root) return null;

  return createPortal(
    <div className={`backdrop is-center ${leaving ? 'is-leaving' : ''}`} onMouseDown={onClose}>
      <section
        className="plugins-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plugins-title"
        onMouseDown={event => event.stopPropagation()}
      >
        <ModalClose className="plugins-close" label="Close plugins" onClick={onClose} />
        <div className="integration-panel">
          <ConnectorsPane connectors={connectors} />
        </div>
      </section>
    </div>,
    root,
  );
}
