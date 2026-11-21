'use client';

import { useEffect, useState } from 'react';
import { normalizeLiveEvent, timelineEntries, whyFromListedDecision } from '../lib/bot-experience.mjs';
import { browserTrace, traceModel } from '../lib/agent-trace.mjs';
import { browserSessionUrl } from '../lib/live-view.mjs';
import { ownerAuthHeaders } from '../lib/owner-auth-headers.mjs';
import { shellRuntimeUrl } from '../lib/runtime-data.mjs';
import { ChainOfThought, TerminalBlock, ToolCall } from './ai/elements';
import ChatBubbles from './ChatBubbles';
import ShoppingPanel from './ShoppingPanel';
import WhyView from './WhyView';

function liveEventsUrl(botId) {
  if (typeof botId !== 'string' || !/^[a-zA-Z0-9:_-]{1,128}$/.test(botId)) return null;
  return shellRuntimeUrl(`/api/events?botId=${encodeURIComponent(botId)}`);
}

function liveDecisionsUrl(botId) {
  if (typeof botId !== 'string' || !/^[a-zA-Z0-9:_-]{1,128}$/.test(botId)) return null;
  return shellRuntimeUrl(`/api/decisions?botId=${encodeURIComponent(botId)}`);
}

export default function AgentThread({
  bot,
  ownerId = null,
  getAccessToken = null,
  lines = [],
  thinking = false,
  onParty = null,
  onEdit = null,
  onAccess = null,
  onGoalDecision = null,
  focusLine = null,
  hideAccessActions = false,
}) {
  const [remoteEvents, setRemoteEvents] = useState(null);
  const [why, setWhy] = useState(null);
  const [sessions, setSessions] = useState([]);
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
          headers: await ownerAuthHeaders(ownerId, getAccessToken),
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
  }, [bot.id, ownerId, getAccessToken]);

  useEffect(() => {
    setWhy(null);
    const url = liveDecisionsUrl(bot.id);
    if (!url || !ownerId) return undefined;
    let stop = false;
    async function load() {
      try {
        const response = await fetch(url, {
          headers: await ownerAuthHeaders(ownerId, getAccessToken),
          cache: 'no-store',
        });
        const data = await response.json();
        if (stop || !response.ok || !Array.isArray(data.items) || data.items.length === 0) return;
        setWhy(whyFromListedDecision(data.items[0]));
      } catch {
        // The thread stays on the conversation when decisions cannot be read.
      }
    }
    load();
    return () => { stop = true; };
  }, [bot.id, ownerId, getAccessToken]);

  useEffect(() => {
    setSessions([]);
    const url = browserSessionUrl('shell', bot.id);
    if (!url || !ownerId) return undefined;
    let stop = false;
    async function load() {
      try {
        const response = await fetch(url, {
          headers: await ownerAuthHeaders(ownerId, getAccessToken),
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
  }, [bot.id, ownerId, getAccessToken]);

  const entries = remoteEvents ? timelineEntries(remoteEvents, bot.id) : [];
  const trace = traceModel(entries);
  const browser = browserTrace(sessions);
  const chips = [...browser.chips, ...trace.chips];
  const sections = browser.section ? [browser.section, ...trace.sections] : trace.sections;
  const focused = focus ? entries.find(entry => entry.id === focus) : null;

  return (
    <div className="agent-thread">
      <ChatBubbles lines={lines} thinking={thinking} onParty={onParty} onEdit={onEdit} onAccess={onAccess} focusId={focusLine} hideAccessActions={hideAccessActions}
        goalProposalId={bot.goalProposal?.id} onGoalDecision={onGoalDecision} />
      {chips.length > 0 ? (
        <div className="agent-chips">
          {chips.map(chip => (
            chip.name === 'Transaction' ? (
              <TerminalBlock key={chip.id} command={[chip.argument, chip.detail].filter(Boolean).join('\n')} status={chip.status} />
            ) : (
              <ToolCall key={chip.id} name={chip.name} input={chip.argument} command={chip.argument} output={chip.detail} status={chip.status} />
            )
          ))}
        </div>
      ) : null}
      <ChainOfThought sections={sections} onSelect={setFocus} />
      {focused ? <p className="agent-focus">{focused.summary}</p> : null}
      <ShoppingPanel bot={bot} ownerId={ownerId} getAccessToken={getAccessToken} />
      {why ? <WhyView why={why} /> : null}
    </div>
  );
}
