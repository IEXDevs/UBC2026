'use client';

import { useEffect, useState } from 'react';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import ProviderAdd from './ProviderAdd';
import { readProviderViews, removeProvider } from '../lib/provider-tokens.mjs';

export default function ModelProviders() {
  const [providers, setProviders] = useState([]);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState('');

  function refresh() { setProviders(readProviderViews(localStorage)); }
  useEffect(() => { refresh(); }, []);

  return (
    <section className="model-providers" aria-labelledby="plugins-title">
      <header className="model-provider-head">
        <div>
          <p className="plugin-kicker">AI settings</p>
          <h2 id="plugins-title">Model providers</h2>
          <p className="quiet">Manage your API credentials in one place.</p>
        </div>
        <button type="button" className="solid" onClick={() => setAdding(true)}><Plus size={16} />Add provider</button>
      </header>
      <div className="provider-storage-note"><KeyRound size={18} /><p>Tokens are saved only in this browser. Chat continues to use the account’s configured model key.</p></div>
      {providers.length ? (
        <ul className="model-provider-list">
          {providers.map(item => (
            <li key={item.id}>
              <span className="model-provider-icon"><KeyRound size={20} /></span>
              <div><strong>{item.name}</strong><span>{item.baseUrl || 'Custom endpoint'}</span><code>{item.hint}</code></div>
              <button type="button" className="provider-remove" aria-label={`Remove ${item.name}`} onClick={() => {
                try { removeProvider(localStorage, item.id); refresh(); setNote(`${item.name} removed.`); }
                catch { setNote('Could not remove this provider. Try again.'); }
              }}><Trash2 size={15} />Remove</button>
            </li>
          ))}
        </ul>
      ) : <div className="model-provider-empty"><span className="model-provider-icon"><KeyRound size={24} /></span><h3>No custom providers</h3><p>Add an API token to keep your provider credentials here.</p></div>}
      {note ? <p className="quiet" role="status">{note}</p> : null}
      <ProviderAdd open={adding} onClose={() => setAdding(false)} onSaved={refresh} />
    </section>
  );
}
