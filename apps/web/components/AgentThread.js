'use client';

import { useEffect, useState } from 'react';
import { normalizeLiveEvent, timelineEntries } from '../lib/bot-experience.mjs';
import { browserTrace, traceModel } from '../lib/agent-trace.mjs';
import { browserSessionUrl, liveViewFrame } from '../lib/live-view.mjs';
import { shellRuntimeUrl } from '../lib/runtime-data.mjs';
import { ChainOfThought, TerminalBlock, ToolCall } from './ai/elements';
import ChatBubbles from './ChatBubbles';
import GlassSurface from './GlassSurface';
import ShoppingPanel from './ShoppingPanel';

function liveEventsUrl(botId) {
  if (typeof botId !== 'string' || !/^[a-zA-Z0-9:_-]{1,128}$/.test(botId)) return null;
  return shellRuntimeUrl(`/api/events?botId=${encodeURIComponent(botId)}`);
}

export default function AgentThread({ bot, ownerId = null, lines = [], thinking = false, onParty = null }) {
  const [remoteEvents, setRemoteEvents] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [frame, setFrame] = useState(null);
  const [focus, setFocus] = useState(null);

  useEffect(() => {
    setFocus(null);
    setRemoteEvents(null);
    const url = liveEventsUrl(bot.id);
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
        setRemoteEvents(data.items.map(normalizeLiveEvent).filter(Boolean));
      } catch {
        // Keep the thread on the conversation when the runtime is unreachable.
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
    setSessions([]);
    setFrame(null);
    const url = browserSessionUrl('shell', bot.id);
    if (!url || !ownerId) return undefined;
    let stop = false;
    async function load() {
      try {
        const response = await fetch(url, {
          headers: { 'x-owner-id': ownerId },
          cache: 'no-store',
        });
        const data = await response.json();
        if (stop || !response.ok || !Array.isArray(data.sessions)) return;
        setSessions(data.sessions.filter(row => row?.status === 'open'));
      } catch {
        // The thread stays on the conversation when browser sessions cannot be listed.
      }
    }
    load();
    const timer = setInterval(load, 4000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [bot.id, ownerId]);

  const openSession = sessions.find(row => row.status === 'open') ?? null;

  useEffect(() => {
    if (!openSession || !ownerId) {
      setFrame(null);
      return undefined;
    }
    const url = browserSessionUrl('shell', bot.id, {
      sessionRecordId: openSession.sessionRecordId,
      action: 'live-view',
    });
    if (!url) return undefined;
    let stop = false;
    async function load() {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-owner-id': ownerId },
          cache: 'no-store',
        });
        const data = await response.json();
        if (stop || !response.ok) return;
        const next = liveViewFrame(data);
        setFrame(next.src ? next : null);
      } catch {
        if (!stop) setFrame(null);
      }
    }
    load();
    return () => { stop = true; };
  }, [bot.id, ownerId, openSession?.sessionRecordId]);

  const entries = remoteEvents ? timelineEntries(remoteEvents, bot.id) : [];
  const trace = traceModel(entries);
  const browser = browserTrace(sessions);
  const chips = [...browser.chips, ...trace.chips];
  const sections = browser.section ? [browser.section, ...trace.sections] : trace.sections;
  const focused = focus ? entries.find(entry => entry.id === focus) : null;

  return (
    <div className="agent-thread">
      <ChatBubbles lines={lines} thinking={thinking} onParty={onParty} />
      {chips.length > 0 ? (
        <div className="agent-chips">
          {chips.map(chip => (
            chip.name === 'Transaction' ? (
              <TerminalBlock key={chip.id} command={chip.argument} status={chip.status} />
            ) : (
              <ToolCall key={chip.id} name={chip.name} input={chip.argument} status={chip.status} />
            )
          ))}
        </div>
      ) : null}
      {frame?.embed && frame.src ? (
        <GlassSurface
          className="agent-browser"
          width="100%"
          height={280}
          borderRadius={18}
          borderWidth={0.08}
          brightness={48}
          opacity={0.94}
          blur={10}
          backgroundOpacity={0.18}
          saturation={1.4}
          distortionScale={-36}
        >
          <iframe
            className="live-frame"
            title="Browser live view"
            src={frame.src}
            referrerPolicy={frame.referrerPolicy}
          />
        </GlassSurface>
      ) : null}
      <ChainOfThought sections={sections} onSelect={setFocus} />
      {focused ? <p className="agent-focus">{focused.summary}</p> : null}
      <ShoppingPanel bot={bot} ownerId={ownerId} />
    </div>
  );
}
