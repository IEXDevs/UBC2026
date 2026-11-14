'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { groupConnectors, readSharedLinks, withSharedLinks, writeSharedLinks } from '../lib/connectors.mjs';
import PluginBento from './PluginBento';

function sharedLine(bots) {
  const names = bots.map(bot => bot.name).filter(Boolean);
  if (names.length === 0) return 'Every agent shares this set.';
  if (names.length === 1) return `Shared by ${names[0]}.`;
  if (names.length === 2) return `Shared by ${names[0]} and ${names[1]}.`;
  return `Shared by ${names.slice(0, -1).join(', ')}, and ${names.at(-1)}.`;
}

export default function ConnectorsPane({ connectors = [], bots = [] }) {
  const [query, setQuery] = useState('');
  const [extra, setExtra] = useState([]);
  const [motionOn, setMotionOn] = useState(false);

  useEffect(() => {
    setExtra(readSharedLinks());
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setMotionOn(!media.matches);
    sync();
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, []);

  const rows = useMemo(() => withSharedLinks(connectors, extra), [connectors, extra]);
  const groups = useMemo(() => groupConnectors(rows, query), [rows, query]);
  const tiles = query.trim() ? [...groups.linked, ...groups.available] : rows;

  function toggle(item) {
    if (item.builtin) return;
    const next = item.linked ? extra.filter(id => id !== item.id) : [...extra, item.id];
    setExtra(next);
    writeSharedLinks(next);
  }

  return (
    <section className="plugin-page" aria-label="Plugins">
      <header className="plugin-hero">
        <div>
          <p className="plugin-kicker">{sharedLine(bots)}</p>
          <h2>Plugins</h2>
        </div>
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
      </header>
      {tiles.length > 0 ? (
        <PluginBento items={tiles} motionOn={motionOn} onToggle={toggle} />
      ) : (
        <p className="preview-note">Nothing matches “{query.trim()}”.</p>
      )}
    </section>
  );
}
