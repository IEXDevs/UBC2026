'use client';

import { useEffect, useState } from 'react';
import ApprovalPreview from './ApprovalPreview';
import BotTimeline from './BotTimeline';
import ShoppingPanel from './ShoppingPanel';
import WhyView from './WhyView';
import { buildBotPage, eventsUrl } from '../lib/bot-experience.mjs';

const runtimeBase = process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL ?? '';

export default function BotPage({ bot, ownerId = null, onConversationEvent = null }) {
  const [remoteEvents, setRemoteEvents] = useState([]);
  const [focus, setFocus] = useState(null);
  const [eventsNote, setEventsNote] = useState('');

  useEffect(() => {
    setFocus(null);
    setRemoteEvents([]);
    setEventsNote('');
    const url = eventsUrl(runtimeBase, bot.id);
    if (!url || !ownerId) {
      setEventsNote(ownerId ? 'Set NEXT_PUBLIC_AGENT_RUNTIME_URL to load the live timeline.' : 'Sign in to load this bot’s timeline.');
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
          setEventsNote('Could not load events from the Worker.');
          return;
        }
        setRemoteEvents(data.items);
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

  const page = buildBotPage({
    botId: bot.id,
    preview: null,
    events: remoteEvents,
    decision: null,
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
        live={Boolean(ownerId && runtimeBase)}
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
