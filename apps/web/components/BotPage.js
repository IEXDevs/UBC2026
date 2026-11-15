'use client';

import { useEffect, useState } from 'react';
import ApprovalPreview from './ApprovalPreview';
import BotTimeline from './BotTimeline';
import ShoppingPanel from './ShoppingPanel';
import WhyView from './WhyView';
import { buildBotPage, normalizeLiveEvent } from '../lib/bot-experience.mjs';
import { shellRuntimeUrl } from '../lib/runtime-data.mjs';

function liveEventsUrl(botId) {
  if (typeof botId !== 'string' || !/^[a-zA-Z0-9:_-]{1,128}$/.test(botId)) return null;
  return shellRuntimeUrl(`/api/events?botId=${encodeURIComponent(botId)}`);
}

function liveDecisionsUrl(botId) {
  if (typeof botId !== 'string' || !/^[a-zA-Z0-9:_-]{1,128}$/.test(botId)) return null;
  return shellRuntimeUrl(`/api/decisions?botId=${encodeURIComponent(botId)}`);
}

export default function BotPage({ bot, ownerId = null, onConversationEvent = null }) {
  const [remoteEvents, setRemoteEvents] = useState([]);
  const [decision, setDecision] = useState(null);
  const [focus, setFocus] = useState(null);
  const [eventsNote, setEventsNote] = useState('');

  useEffect(() => {
    setFocus(null);
    setRemoteEvents([]);
    setDecision(null);
    setEventsNote('');
    const url = liveEventsUrl(bot.id);
    if (!url || !ownerId) {
      setEventsNote(ownerId ? 'This bot id cannot be loaded from the runtime.' : 'Sign in to load this bot’s timeline.');
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
        if (stop) return;
        if (!response.ok || !Array.isArray(data.items)) {
          setEventsNote(data.error === 'runtime_unconfigured' ? 'The agent runtime is not configured.' : 'Could not load events from the Worker.');
          return;
        }
        setRemoteEvents(data.items.map(normalizeLiveEvent).filter(Boolean));
        setEventsNote(data.source === 'unconfigured' ? 'Worker Supabase is not configured.' : '');
      } catch {
        if (!stop) setEventsNote('Could not reach the Worker for events.');
      }
    }
    load();
    const timer = setInterval(load, 4000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [bot.id, ownerId]);

  useEffect(() => {
    const url = liveDecisionsUrl(bot.id);
    if (!url || !ownerId) return undefined;
    let stop = false;
    async function load() {
      try {
        const response = await fetch(url, {
          headers: { 'x-owner-id': ownerId },
          cache: 'no-store',
        });
        const data = await response.json();
        if (stop || !response.ok || !Array.isArray(data.items) || data.items.length === 0) return;
        const row = data.items[0];
        if (!row || typeof row !== 'object') return;
        setDecision(row);
      } catch {
        /* The timeline still shows events when decisions are unreachable. */
      }
    }
    load();
    return () => { stop = true; };
  }, [bot.id, ownerId]);

  const page = buildBotPage({
    botId: bot.id,
    preview: null,
    events: remoteEvents,
    decision,
  });
  const approval = page.sections[0].preview;
  const entries = page.sections[1].entries;
  const why = focus
    ? { ...page.sections[3].why, focus: { id: focus.id, summary: focus.summary } }
    : page.sections[3].why;

  function note(event) {
    onConversationEvent?.(event);
  }

  return (
    <div className="bot-page">
      {eventsNote ? <p className="preview-note">{eventsNote}</p> : null}
      {approval ? <ApprovalPreview preview={approval} botType={bot.type} /> : null}
      {bot.type === 'shopping' ? <ShoppingPanel bot={bot} ownerId={ownerId} onEvent={note} /> : null}
      <BotTimeline
        entries={entries}
        live={Boolean(ownerId)}
        onWhy={(entry) => {
          setFocus(entry);
          if (entry?.summary) note({ kind: entry.kind || 'timeline', summary: entry.summary });
        }}
      />
      {entries.length === 0 && !eventsNote ? (
        <p className="preview-note">No events yet for this bot.</p>
      ) : null}
      {focus ? <WhyView why={why} /> : null}
    </div>
  );
}
