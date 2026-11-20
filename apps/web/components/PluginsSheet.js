'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import ConnectorsPane from './ConnectorsPane';
import { usePresence } from './usePresence';
import ModelProviders from './ModelProviders';

export default function PluginsSheet({ open, onClose, connectors = [] }) {
  const { mounted, leaving } = usePresence(open);
  const [tab, setTab] = useState('apps');
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
        <button type="button" className="plugins-close" aria-label="Close plugins" onClick={onClose}>
          <X size={18} strokeWidth={1.75} />
        </button>
        <div className="integration-tabs" role="tablist" aria-label="Integration settings">
          <button type="button" id="apps-tab" role="tab" aria-selected={tab === 'apps'} aria-controls="apps-panel" onClick={() => setTab('apps')}>Apps</button>
          <button type="button" id="models-tab" role="tab" aria-selected={tab === 'models'} aria-controls="models-panel" onClick={() => setTab('models')}>Model providers</button>
        </div>
        <div className="integration-panel" id={`${tab}-panel`} role="tabpanel" aria-labelledby={`${tab}-tab`}>
          {tab === 'apps' ? <ConnectorsPane connectors={connectors} /> : <ModelProviders />}
        </div>
      </section>
    </div>,
    root,
  );
}
