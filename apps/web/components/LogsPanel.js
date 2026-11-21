'use client';

import { useEffect, useState } from 'react';
import MentionText from './MentionText';
import { ownerAuthHeaders } from '../lib/owner-auth-headers.mjs';
import { shellRuntimeUrl } from '../lib/runtime-data.mjs';
import { formatLogTime, logRows } from '../lib/txn-preview.mjs';

export default function LogsPanel({ ownerId, getAccessToken, onParty, receipts, payments, transfers }) {
  const [events, setEvents] = useState([]);
  const [activity, setActivity] = useState({ items: [], status: 'loading' });
  useEffect(() => {
    if (!ownerId) return undefined;
    const controller = new AbortController();
    let timer;
    async function load() {
      try {
        const headers = await ownerAuthHeaders(ownerId, getAccessToken);
        if (controller.signal.aborted) return;
        const response = await fetch('/api/portfolio?activity=1', {
          headers, cache: 'no-store', signal: controller.signal,
        });
        if (!response.ok) throw new Error('Wallet activity unavailable');
        const data = await response.json();
        if (!Array.isArray(data.items)) throw new Error('Invalid wallet activity');
        if (!controller.signal.aborted) {
          setActivity(previous => ({
            status: data.incomplete ? 'partial' : 'ready',
            items: data.incomplete
              ? [...new Map([...previous.items, ...data.items].map(row => [row.id, row])).values()]
              : data.items,
          }));
        }
      } catch {
        if (!controller.signal.aborted) setActivity(previous => ({ ...previous, status: 'failed' }));
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(load, 30000);
      }
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [ownerId, getAccessToken]);

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

  const status = activity.status === 'loading' ? 'Loading wallet transactions…'
    : activity.status === 'failed' ? 'Could not refresh wallet transactions.'
    : activity.status === 'partial' ? 'Some wallet transactions could not load.' : null;
  const rows = logRows({ receipts, payments, transfers, history: activity.items, events });

  return (
    <section className="panel logs-page" aria-label="Logs">
      <h2>Logs</h2>
      {status ? <p role="status">{status}</p> : null}
      {rows.length === 0 ? (status ? null : <p>No transactions, transfers, or payments yet.</p>) : (
        <ul className="quiet-list">
          {rows.map(row => (
            <li key={row.id}>
              <strong>{row.title}</strong>
              {row.at ? <small>{formatLogTime(row.at)}</small> : null}
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
