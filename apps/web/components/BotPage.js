'use client';

import { useEffect, useState } from 'react';
import ApprovalPreview from './ApprovalPreview';
import BotTimeline from './BotTimeline';
import ShoppingPanel from './ShoppingPanel';
import WhyView from './WhyView';
import { buildBotPage, eventsUrl } from '../lib/bot-experience.mjs';

const runtimeBase = process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL ?? '';

export default function BotPage({ bot, ownerId = null, onConversationEvent = null }) {
  const [remoteEvents, setRemoteEvents] = useState(null);
  const [focus, setFocus] = useState(null);
  const experience = bot.experience ?? { preview: null, events: [], decision: null };

  useEffect(() => {
    setFocus(null);
    setRemoteEvents(null);
    const url = eventsUrl(runtimeBase, bot.id);
    if (!url || !ownerId) return undefined;
    let stop = false;
    async function load() {
      try {
        const response = await fetch(url, {
          headers: { 'x-owner-id': ownerId },
          cache: 'no-store',
        });
        const data = await response.json();
        if (stop || !response.ok || data.stub || !Array.isArray(data.items)) return;
        setRemoteEvents(data.items);
      } catch {
        // Keep the stored timeline when the runtime is unreachable.
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
    preview: experience.preview,
    events: remoteEvents ?? experience.events,
    decision: experience.decision,
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
      <ApprovalPreview preview={approval} botType={bot.type} />
      <ShoppingPanel bot={bot} ownerId={ownerId} onEvent={note} />
      <BotTimeline
        entries={entries}
        live={remoteEvents != null}
        onWhy={(entry) => {
          setFocus(entry);
          if (entry?.summary) note({ kind: entry.kind || 'timeline', summary: entry.summary });
        }}
      />
      {focus ? <WhyView why={why} /> : null}
    </div>
  );
}
