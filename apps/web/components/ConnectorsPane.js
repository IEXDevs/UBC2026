'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppWindow, BadgeDollarSign, Check, ChevronRight, Fingerprint, Search } from 'lucide-react';
import { PLUGIN_CHIPS, pluginCatalog, readSharedLinks, withSharedLinks, writeSharedLinks } from '../lib/connectors.mjs';
import { readProviderViews, removeProvider, saveProvider } from '../lib/provider-tokens.mjs';
import Spotlight from './bits/Spotlight';
import './bits/Spotlight.css';

const SOLANA_MARK = 'm23.8764 18.0313-3.962 4.1393a.9201.9201 0 0 1-.306.2106.9407.9407 0 0 1-.367.0742H.4599a.4689.4689 0 0 1-.2522-.0733.4513.4513 0 0 1-.1696-.1962.4375.4375 0 0 1-.0314-.2545.4438.4438 0 0 1 .117-.2298l3.9649-4.1393a.92.92 0 0 1 .3052-.2102.9407.9407 0 0 1 .3658-.0746H23.54a.4692.4692 0 0 1 .2523.0734.4531.4531 0 0 1 .1697.196.438.438 0 0 1 .0313.2547.4442.4442 0 0 1-.1169.2297zm-3.962-8.3355a.9202.9202 0 0 0-.306-.2106.941.941 0 0 0-.367-.0742H.4599a.4687.4687 0 0 0-.2522.0734.4513.4513 0 0 0-.1696.1961.4376.4376 0 0 0-.0314.2546.444.444 0 0 0 .117.2297l3.9649 4.1394a.9204.9204 0 0 0 .3052.2102c.1154.049.24.0744.3658.0746H23.54a.469.469 0 0 0 .2523-.0734.453.453 0 0 0 .1697-.1961.4382.4382 0 0 0 .0313-.2546.4444.4444 0 0 0-.1169-.2297zM.46 6.7225h18.7815a.9411.9411 0 0 0 .367-.0742.9202.9202 0 0 0 .306-.2106l3.962-4.1394a.4442.4442 0 0 0 .117-.2297.4378.4378 0 0 0-.0314-.2546.453.453 0 0 0-.1697-.196.469.469 0 0 0-.2523-.0734H4.7596a.941.941 0 0 0-.3658.0745.9203.9203 0 0 0-.3052.2102L.1246 5.9687a.4438.4438 0 0 0-.1169.2295.4375.4375 0 0 0 .0312.2544.4512.4512 0 0 0 .1692.196.4689.4689 0 0 0 .2518.0739z';

function DrawnMark({ id }) {
  if (id === 'solana') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#9945FF" d={SOLANA_MARK} />
      </svg>
    );
  }
  if (id === 'privy') return <Fingerprint size={20} strokeWidth={1.75} color="#5b21b6" />;
  if (id === 'browser-run') return <AppWindow size={20} strokeWidth={1.75} color="#0369a1" />;
  if (id === 'x402') return <BadgeDollarSign size={20} strokeWidth={1.75} color="#92400e" />;
  return null;
}

function AppIcon({ item, mini = false }) {
  const [failed, setFailed] = useState(false);
  const letter = item.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 1).toUpperCase() || '?';
  const drawn = (!item.logo || failed) ? <DrawnMark id={item.id} /> : null;
  return (
    <span className={`app-icon${mini ? ' is-mini' : ''}`} aria-hidden="true">
      {item.logo && !failed ? (
        <img
          src={item.logo}
          alt=""
          width={mini ? 14 : 26}
          height={mini ? 14 : 26}
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : drawn || <span className="app-letter">{letter}</span>}
    </span>
  );
}

export default function ConnectorsPane({ connectors = [] }) {
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState('all');
  const [connectedOnly, setConnectedOnly] = useState(false);
  const [showAllRecommended, setShowAllRecommended] = useState(false);
  const [extra, setExtra] = useState([]);
  const [providers, setProviders] = useState([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', token: '', baseUrl: '' });
  const [note, setNote] = useState('');

  useEffect(() => {
    setExtra(readSharedLinks());
    setProviders(readProviderViews(localStorage));
  }, []);

  const rows = useMemo(() => {
    const catalog = withSharedLinks(connectors, extra);
    const known = new Set(catalog.map(item => item.id));
    return [...providers.filter(item => !known.has(item.id)), ...catalog];
  }, [connectors, extra, providers]);
  const linked = rows.filter(row => row.linked);
  const sections = useMemo(
    () => pluginCatalog(rows, { query, chip, connectedOnly, showAllRecommended }),
    [rows, query, chip, connectedOnly, showAllRecommended],
  );

  function remember(next) {
    setExtra(next);
    writeSharedLinks(next);
    setProviders(readProviderViews(localStorage));
  }

  function toggle(item) {
    if (item.builtin) return;
    setNote('');
    if (item.custom) {
      removeProvider(localStorage, item.id);
      remember(extra.filter(id => id !== item.id));
      return;
    }
    if (item.linked) {
      removeProvider(localStorage, item.id);
      remember(extra.filter(id => id !== item.id));
      return;
    }
    remember(extra.includes(item.id) ? extra : [...extra, item.id]);
  }

  function addProvider(event) {
    event.preventDefault();
    const result = saveProvider(localStorage, draft);
    if (!result.ok) {
      setNote(result.reason === 'url' ? 'Use an https provider URL.' : result.reason === 'name' ? 'Use a short provider name.' : 'Use a token of at least 8 characters.');
      return;
    }
    setDraft({ name: '', token: '', baseUrl: '' });
    setAdding(false);
    setNote('');
    setProviders(readProviderViews(localStorage));
  }

  return (
    <section className="app-catalog" aria-label="Plugins">
      <header className="app-head">
        <div>
          <h2 id="plugins-title">Connect apps</h2>
          <p className="app-lead">These apps connect through Composio. Solana, Privy, and the rest stay on.</p>
        </div>
        <button
          type="button"
          className={`app-linked${connectedOnly ? ' is-on' : ''}`}
          aria-pressed={connectedOnly}
          onClick={() => setConnectedOnly(value => !value)}
        >
          <span className="app-stack">
            {linked.slice(0, 4).map(item => <AppIcon key={item.id} item={item} mini />)}
          </span>
          <span>{linked.length} connected</span>
          <ChevronRight size={14} strokeWidth={1.75} />
        </button>
      </header>
      <form className="app-search" onSubmit={event => event.preventDefault()}>
        <Search size={16} strokeWidth={1.75} />
        <label className="sr-only" htmlFor="connector-search">Search apps</label>
        <input
          id="connector-search"
          type="search"
          placeholder="Search Composio apps"
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
      </form>
      <div className="app-chips" role="tablist" aria-label="App categories">
        {PLUGIN_CHIPS.map(item => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className={chip === item.id ? 'is-on' : ''}
            aria-selected={chip === item.id}
            onClick={() => setChip(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="app-scroll">
      {sections.length === 0 ? (
        <p className="preview-note">Nothing matches “{query.trim() || 'that filter'}”.</p>
      ) : sections.map(section => (
        <section key={section.id} className="app-section" aria-label={section.title || 'Apps'}>
          {section.title ? (
            <div className="app-section-head">
              <h3>{section.title}</h3>
              {section.canExpand ? (
                <button type="button" className="app-view-all" onClick={() => setShowAllRecommended(true)}>
                  View all
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="app-grid">
            {section.items.map(item => (
              <Spotlight key={item.id} className="app-row">
                <AppIcon item={item} />
                <strong title={item.name}>{item.name}</strong>
                <span className="app-detail">{item.detail}</span>
                <span className="app-actions">
                  {item.linked ? (
                    item.builtin ? (
                      <span className="app-state">
                        <Check size={14} strokeWidth={2.25} />
                        Connected
                      </span>
                    ) : (
                      <button type="button" className="app-state" aria-label={`Disconnect ${item.name}`} onClick={() => toggle(item)}>
                        <Check size={14} strokeWidth={2.25} />
                        Connected
                      </button>
                    )
                  ) : (
                    <button type="button" className="app-connect" aria-label={`Connect ${item.name}`} onClick={() => toggle(item)}>
                      Connect
                    </button>
                  )}
                </span>
              </Spotlight>
            ))}
          </div>
        </section>
      ))}
      <div className="provider-add">
        <button type="button" className="app-view-all" onClick={() => { setAdding(value => !value); setNote(''); }}>
          {adding ? 'Cancel custom provider' : 'Add a custom provider'}
        </button>
        {adding ? (
          <form className="provider-form" onSubmit={addProvider}>
            <input aria-label="Provider name" placeholder="Provider name" value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} />
            <input aria-label="API token" type="password" autoComplete="off" placeholder="API token" value={draft.token} onChange={event => setDraft(current => ({ ...current, token: event.target.value }))} />
            <input aria-label="Provider URL" placeholder="https://api.example.com" value={draft.baseUrl} onChange={event => setDraft(current => ({ ...current, baseUrl: event.target.value }))} />
            <button type="submit">Save token</button>
          </form>
        ) : null}
        {note ? <p className="preview-note" role="status">{note}</p> : null}
      </div>
      </div>
    </section>
  );
}
