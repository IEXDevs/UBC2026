'use client';

import { useEffect, useState } from 'react';
import MentionText from './MentionText';
import { ownerAuthHeaders } from '../lib/owner-auth-headers.mjs';
import { shellRuntimeUrl } from '../lib/runtime-data.mjs';
import { formatLogTime, logRows } from '../lib/txn-preview.mjs';

export default function LogsPanel({ ownerId, getAccessToken, onParty, receipts, payments, transfers }) {
  const [events, setEvents] = useState([]);
  useEffect(() => {
    const url = shellRuntimeUrl('/api/events');
    if (!url || !ownerId) return undefined;
    let stop = false;
    async function load() {
      try {
        const response = await fetch(url, {
          headers: await ownerAuthHeaders(ownerId, getAccessToken),
          cache: 'no-store',
        });
        if (!response.ok) return;
        const data = await response.json();
        if (!stop && Array.isArray(data.items)) setEvents(data.items);
      } catch {
        // Keep the most recent timeline if a refresh fails.
      }
    }
    void load();
    const timer = setInterval(load, 4000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [ownerId, getAccessToken]);

  const rows = logRows({ receipts, payments, transfers, events });

  return (
    <section className="panel logs-page" aria-label="Logs">
      <h2>Logs</h2>
      {rows.length === 0 ? <p>No transactions, transfers, or payments yet.</p> : (
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
