'use client';

import { useEffect, useState } from 'react';
import MentionText from './MentionText';
import { shellRuntimeUrl } from '../lib/runtime-data.mjs';
import { formatLogTime, logRows } from '../lib/txn-preview.mjs';

export default function LogsPanel({
  bots,
  ownerId = null,
  onParty,
  receipts = [],
  payments = [],
  transfers = [],
}) {
  const [remote, setRemote] = useState(null);

  useEffect(() => {
    const url = shellRuntimeUrl('/api/logs');
    if (!url || !ownerId) {
      setRemote(null);
      return undefined;
    }
    let stop = false;
    async function load() {
      try {
        const response = await fetch(url, {
          headers: { 'x-owner-id': ownerId },
          cache: 'no-store',
        });
        const data = await response.json();
        if (stop || !response.ok || !Array.isArray(data.items)) return;
        setRemote(data.items);
      } catch {
        if (!stop) setRemote(null);
      }
    }
    load();
    const timer = setInterval(load, 4000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [ownerId]);

  const moneyRows = logRows({
    receipts,
    payments,
    transfers,
    activity: Array.isArray(remote) ? remote : [],
  });
  const seen = new Set(moneyRows.map(row => row.id));
  const localRows = Array.isArray(remote) ? [] : (Array.isArray(bots) ? bots : [])
    .flatMap(bot => (bot.experience?.events ?? []).map(event => ({
      id: event.id,
      at: event.at,
      title: event.kind || bot.name,
      lines: [
        event.summary ? { label: 'Event', value: event.summary } : null,
        bot.name ? { label: 'Agent', value: bot.name } : null,
      ].filter(Boolean),
      solscanUrl: null,
    })))
    .filter(row => row.id && row.lines.length > 0 && !seen.has(row.id))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const rows = [...moneyRows, ...localRows];

  return (
    <section className="panel logs-page" aria-label="Logs">
      <h2>Logs</h2>
      <p className="hint">
        {remote
          ? 'Each line keeps the time, the transfer, and a Solscan link when a signature exists. Private keys stay out.'
          : 'Recent sends, quotes, and tool events. A Solscan link appears when a signature exists.'}
      </p>
      {rows.length === 0 ? <p>No log lines yet.</p> : (
        <ul className="quiet-list">
          {rows.map(row => (
            <li key={row.id}>
              <strong>{row.title}</strong>
              <small>{formatLogTime(row.at)}</small>
              {row.lines.map(line => (
                <span key={`${row.id}-${line.label}`}>
                  {line.label}: <MentionText text={line.value} onParty={onParty} />
                </span>
              ))}
              {row.solscanUrl ? (
                <a className="log-link" href={row.solscanUrl} target="_blank" rel="noreferrer">View on Solscan</a>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
