'use client';

import { useEffect, useRef, useState } from 'react';
import { BrainCircuit, KeyRound, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import ProviderAdd from './ProviderAdd';
import { readProviderCredentials, removeProvider } from '../lib/provider-tokens.mjs';
import {
  ACCOUNT_PROVIDER, MODEL_SETTINGS_EVENT, announceModelSettings, forgetProviderModels,
  modelOptionKey, providerModelGroups, readHiddenModels, saveModelCatalog, setModelVisible,
} from '../lib/provider-models.mjs';

function checkError(code) {
  if (code === 'provider_unauthorized') return 'The key was not accepted. Remove this provider and add it with a valid key.';
  if (code === 'provider_not_supported') return 'Choose Meta, OpenAI, or OpenRouter when adding a provider.';
  return 'Could not check models. Your saved list is unchanged; try again.';
}

export default function ModelProviders() {
  const [groups, setGroups] = useState([]);
  const [hidden, setHidden] = useState(new Set());
  const [adding, setAdding] = useState(false);
  const [checks, setChecks] = useState({});
  const [search, setSearch] = useState('');
  const [note, setNote] = useState('');
  const pending = useRef(new Set());

  function refresh() {
    setGroups(providerModelGroups(localStorage));
    setHidden(readHiddenModels(localStorage));
  }

  useEffect(() => {
    refresh();
    window.addEventListener(MODEL_SETTINGS_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(MODEL_SETTINGS_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  async function checkModels(provider) {
    if (pending.current.has(provider.id)) return;
    pending.current.add(provider.id);
    setChecks(current => ({ ...current, [provider.id]: { busy: true } }));
    try {
      const credentials = provider.id === ACCOUNT_PROVIDER ? null : readProviderCredentials(localStorage, provider.id);
      if (provider.id !== ACCOUNT_PROVIDER && !credentials) throw new Error('provider_not_supported');
      const response = await fetch('/api/models', {
        ...(credentials ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) } : {}),
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
      const data = await response.json();
      if (!response.ok || data.checked === false || data.ok === false || !Array.isArray(data.models)) throw new Error(data.error || 'provider_unavailable');
      if (provider.id !== ACCOUNT_PROVIDER && JSON.stringify(readProviderCredentials(localStorage, provider.id)) !== JSON.stringify(credentials)) return;
      saveModelCatalog(localStorage, provider.id, data.models);
      announceModelSettings();
      setChecks(current => ({ ...current, [provider.id]: { message: `${data.models.length} chat models available. New models are shown automatically.` } }));
    } catch (error) {
      setChecks(current => ({ ...current, [provider.id]: { error: checkError(error.message) } }));
    } finally {
      pending.current.delete(provider.id);
    }
  }

  function toggle(key, visible) {
    try {
      setModelVisible(localStorage, key, visible);
      announceModelSettings();
      setNote('');
    } catch { setNote('Could not save this choice. Allow browser storage and try again.'); }
  }

  const query = search.trim().toLowerCase();
  const total = groups.reduce((count, provider) => count + provider.models.length, 0);
  const visible = groups.reduce((count, provider) => count + provider.models.filter(model => !hidden.has(modelOptionKey(provider.id, model.id))).length, 0);

  return (
    <section className="model-providers" aria-labelledby="ai-providers-title">
      <header className="model-provider-head">
        <div>
          <p className="plugin-kicker">Model settings</p>
          <h2 id="ai-providers-title">AI Providers</h2>
          <p className="quiet">Connect an AI provider and choose the models in your chat selector.</p>
        </div>
        <button type="button" className="solid" onClick={() => setAdding(true)}><Plus size={16} />Add AI provider</button>
      </header>
      <div className="provider-storage-note">
        <KeyRound size={18} />
        <p>Keys and model preferences are saved in this browser. Keys are used only for model checks and chat requests, never added to messages.</p>
      </div>
      <div className="ai-model-toolbar">
        <label className="ai-model-search"><Search size={16} /><input type="search" aria-label="Search AI models" placeholder="Search models" value={search} onChange={event => setSearch(event.target.value)} /></label>
        <span>{visible} of {total} shown</span>
      </div>
      {total > 0 && visible === 0 ? <p className="ai-provider-status" role="status">All models are hidden. Show a model below to use chat.</p> : null}
      <div className="ai-provider-cards">
        {groups.map(provider => {
          const status = checks[provider.id] || {};
          const matches = provider.models.filter(model => !query || `${model.name} ${model.id} ${provider.name}`.toLowerCase().includes(query));
          return (
            <section className="ai-provider-card" key={provider.id} aria-label={`${provider.name} models`}>
              <header className="ai-provider-card-head">
                <span className="model-provider-icon"><BrainCircuit size={20} /></span>
                <div className="ai-provider-identity"><h3>{provider.name}</h3><p>{provider.id === ACCOUNT_PROVIDER ? 'Included with your account' : provider.baseUrl || 'Choose a supported provider to check models'}</p>{provider.hint ? <code>{provider.hint}</code> : null}</div>
                <div className="ai-provider-actions">
                  <button type="button" className="ghost" disabled={status.busy} onClick={() => checkModels(provider)}><RefreshCw size={14} className={status.busy ? 'ai-model-checking' : ''} />{status.busy ? 'Checking…' : 'Check models'}</button>
                  {provider.id !== ACCOUNT_PROVIDER ? <button type="button" className="provider-remove" aria-label={`Remove ${provider.name}`} onClick={() => {
                    try {
                      removeProvider(localStorage, provider.id);
                      forgetProviderModels(localStorage, provider.id);
                      announceModelSettings();
                      setNote(`${provider.name} removed.`);
                    } catch { setNote('Could not remove this provider. Try again.'); }
                  }}><Trash2 size={15} />Remove</button> : null}
                </div>
              </header>
              <p className="ai-provider-status" role="status">{status.error || status.message || (provider.checked ? `${provider.models.length} chat models · New models are shown by default` : 'Check availability to refresh the models offered by this provider.')}</p>
              {matches.length ? <ul className="ai-model-list">{matches.map(model => {
                const key = modelOptionKey(provider.id, model.id);
                const shown = !hidden.has(key);
                return <li key={key}><div><strong>{model.name}</strong><code>{model.id}</code></div><label className="ai-model-toggle"><span>{shown ? 'Shown' : 'Hidden'}</span><input type="checkbox" role="switch" checked={shown} aria-label={`Show ${model.name} (${provider.name})`} onChange={event => toggle(key, event.target.checked)} /><span className="ai-model-switch" aria-hidden="true" /></label></li>;
              })}</ul> : <p className="ai-model-empty">{query ? 'No models match your search.' : provider.checked ? 'No compatible chat models were returned.' : 'Check models to discover what is available with this key.'}</p>}
            </section>
          );
        })}
      </div>
      {note ? <p className="quiet" role="status">{note}</p> : null}
      <ProviderAdd open={adding} onClose={() => setAdding(false)} onSaved={provider => { refresh(); void checkModels(provider); }} />
    </section>
  );
}
