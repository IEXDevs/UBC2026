'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Search, Settings, X } from 'lucide-react';
import { groupConnectors, readSharedLinks, withSharedLinks, writeSharedLinks } from '../lib/connectors.mjs';

function sharedLine(bots) {
  const names = bots.map(bot => bot.name).filter(Boolean);
  if (names.length === 0) return 'Shared across agents. None exist yet.';
  if (names.length === 1) return `Shared by ${names[0]}.`;
  if (names.length === 2) return `Shared by ${names[0]} and ${names[1]}.`;
  return `Shared by ${names.slice(0, -1).join(', ')}, and ${names.at(-1)}.`;
}

export default function ConnectorsPane({ connectors = [], bots = [] }) {
  const [query, setQuery] = useState('');
  const [extra, setExtra] = useState([]);
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    setExtra(readSharedLinks());
  }, []);

  useEffect(() => {
    if (!openId) return undefined;
    const onKey = event => {
      if (event.key === 'Escape') setOpenId(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openId]);

  const rows = useMemo(() => withSharedLinks(connectors, extra), [connectors, extra]);
  const groups = useMemo(() => groupConnectors(rows, query), [rows, query]);
  const selected = rows.find(item => item.id === openId) ?? null;

  function toggle(item) {
    if (item.builtin) return;
    const next = item.linked ? extra.filter(id => id !== item.id) : [...extra, item.id];
    setExtra(next);
    writeSharedLinks(next);
  }

  return (
    <section className="conn-page" aria-label="Plugins">
      <h2>Plugins</h2>
      <p className="preview-note">
        Connectors are one set for every agent. {sharedLine(bots)} A link here is saved in this browser only. No outside account is connected.
      </p>
      <form className="conn-search" onSubmit={event => event.preventDefault()}>
        <Search size={16} strokeWidth={1.75} />
        <label className="sr-only" htmlFor="connector-search">Search apps</label>
        <input
          id="connector-search"
          type="search"
          placeholder="Search GitHub, Gmail, Slack, Notion…"
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
      </form>
      {groups.linked.length > 0 ? (
        <section>
          <h3>Linked</h3>
          <div className="conn-grid">
            {groups.linked.map(item => (
              <ConnectorCard key={item.id} item={item} onToggle={toggle} onOpen={setOpenId} />
            ))}
          </div>
        </section>
      ) : null}
      <section>
        <h3>{query.trim() ? 'Matches' : 'Popular'}</h3>
        {groups.available.length > 0 ? (
          <div className="conn-grid">
            {groups.available.map(item => (
              <ConnectorCard key={item.id} item={item} onToggle={toggle} onOpen={setOpenId} />
            ))}
          </div>
        ) : (
          <p className="preview-note">{query.trim() ? `Nothing matches “${query.trim()}”.` : 'Nothing else to link.'}</p>
        )}
      </section>
      {selected ? (
        <div className="backdrop is-center" onClick={() => setOpenId(null)}>
          <div
            className="sheet conn-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={`${selected.name} settings`}
            onClick={event => event.stopPropagation()}
          >
            <div className="sheet-head">
              <h2>{selected.name}</h2>
              <button type="button" className="icon-btn" aria-label="Close" onClick={() => setOpenId(null)}>
                <X size={18} strokeWidth={1.75} />
              </button>
            </div>
            <p className={selected.linked ? 'conn-state is-on' : 'conn-state'}>
              {selected.linked ? <Check size={13} strokeWidth={2.2} /> : null}
              {selected.linked ? 'Connected' : 'Not connected'}
            </p>
            <p className="preview-note">{selected.detail} {sharedLine(bots)}</p>
            <div className="sheet-actions">
              <button type="button" className="solid" disabled={selected.builtin} onClick={() => toggle(selected)}>
                {selected.builtin ? 'Ready' : selected.linked ? 'Disconnect' : 'Connect'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ConnectorCard({ item, onToggle, onOpen }) {
  return (
    <article className="conn-tile">
      <div className="conn-main">
        <b>{item.name}</b>
        <p>{item.detail}</p>
      </div>
      <footer>
        <span className={item.linked ? 'conn-state is-on' : 'conn-state'}>
          {item.linked ? <Check size={13} strokeWidth={2.2} /> : null}
          {item.linked ? 'Connected' : 'Not connected'}
        </span>
        <span className="conn-actions">
          {item.linked ? (
            <button type="button" className="icon-btn" aria-label={`${item.name} settings`} onClick={() => onOpen(item.id)}>
              <Settings size={16} strokeWidth={1.75} />
            </button>
          ) : null}
          <button type="button" className="conn-btn" disabled={item.builtin} onClick={() => onToggle(item)}>
            {item.builtin ? 'Ready' : item.linked ? 'Disconnect' : 'Connect'}
          </button>
        </span>
      </footer>
    </article>
  );
}
