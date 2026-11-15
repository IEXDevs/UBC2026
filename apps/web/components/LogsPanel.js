'use client';

import { useEffect, useState } from 'react';
import { logsUrl } from '../lib/bot-experience.mjs';
import MentionText from './MentionText';

const runtimeBase = process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL ?? '';

function stamp(at) {
  const date = typeof at === 'number' ? new Date(at) : new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

function summarize(detail) {
  if (!detail || typeof detail !== 'object') return '';
  try {
    const text = JSON.stringify(detail);
    return text.length > 400 ? `${text.slice(0, 400)}…` : text;
  } catch {
    return '';
  }
}

export default function LogsPanel({ bots, ownerId = null, onParty }) {
  const [remote, setRemote] = useState(null);

  useEffect(() => {
    const url = logsUrl(runtimeBase);
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

  const localRows = (Array.isArray(bots) ? bots : [])
    .flatMap(bot => (bot.experience?.events ?? []).map(event => ({
      id: event.id,
      at: event.at,
      kind: event.kind,
      summary: event.summary,
      bot: bot.name,
    })))
    .filter(row => row.id && row.summary)
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));

  const rows = remote
    ? remote.filter(row => row?.id).map(row => ({
      id: row.id,
      at: row.at,
      kind: [row.action, row.status].filter(part => part != null && part !== '').join(' · '),
      summary: summarize(row.detail) || row.action || '',
      bot: row.botId || row.source || 'account',
    })).filter(row => row.summary)
    : localRows;

  return (
    <section className="panel logs-page" aria-label="Logs">
      <h2>Logs</h2>
      <p className="hint">
        {remote ? 'Activity stored for this account. Private keys and seed phrases are removed.' : 'Recent tool events from each bot.'}
      </p>
      {rows.length === 0 ? <p>No log lines yet.</p> : (
        <ul className="quiet-list">
          {rows.map(row => (
            <li key={row.id}>
              <strong>{row.bot}</strong>
              <small>{stamp(row.at)} · {row.kind}</small>
              <span><MentionText text={row.summary} onParty={onParty} /></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
