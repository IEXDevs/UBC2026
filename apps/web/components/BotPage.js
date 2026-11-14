'use client';

import { useEffect, useState } from 'react';
import ApprovalPreview from './ApprovalPreview';
import BotTimeline from './BotTimeline';
import LiveViewPanel from './LiveViewPanel';
import WhyView from './WhyView';
import { buildBotPage, eventsUrl } from '../lib/bot-experience.mjs';

const runtimeBase = process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL ?? '';

export default function BotPage({ bot, ownerId = null }) {
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

  return (
    <div className="bot-page">
      <ApprovalPreview preview={approval} botType={bot.type} />
      <header className="bot-heading">
        <div className="pill">● {bot.name} · {bot.type} · {bot.status}</div>
        <h1>{bot.goal}</h1>
      </header>
      <BotTimeline entries={entries} live={remoteEvents != null} onWhy={setFocus} />
      <section className="panel" aria-label="Live View">
        <LiveViewPanel botId={bot.id} ownerId={ownerId} />
      </section>
      <WhyView why={why} />
    </div>
  );
}
