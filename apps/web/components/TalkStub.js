'use client';

import { useEffect, useMemo, useState } from 'react';
import { voiceToolDefinitions } from '../lib/voice-client-tools.mjs';
import TalkSession from './TalkSession';

/**
 * ElevenAgents Talk surface (Isaac / 8B).
 * Client tools + live transcript always; live orb when NEXT_PUBLIC_ELEVENLABS_AGENT_ID is set.
 * Webhook tools live on the Worker (/voice/tools) from Alex / 8A.
 */
export default function TalkStub({
  botName = 'agent',
  clientTools = null,
  conversation = null,
  onVoiceEvent = null,
}) {
  const [last, setLast] = useState(null);
  const [transcript, setTranscript] = useState(() => conversation?.entries?.() ?? []);
  const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID || '';
  const defs = useMemo(() => voiceToolDefinitions(), []);

  useEffect(() => {
    if (!conversation?.subscribe) return undefined;
    setTranscript(conversation.entries());
    return conversation.subscribe((_entry, all) => setTranscript(all));
  }, [conversation]);

  async function demoTool(name) {
    if (!clientTools?.[name]) return;
    const params = name === 'open_bot' ? { name: botName }
      : name === 'confirm_dialog' ? { prompt: `Confirm action for ${botName}?`, actionId: 'demo' }
        : name === 'read_back' ? { topic: 'overview' }
          : { };
    const result = await clientTools[name](params);
    setLast({ name, result });
    if (result?.text) conversation?.pushAssistant?.(result.text);
    if (typeof onVoiceEvent === 'function') onVoiceEvent({ name, result });
  }

  return (
    <section className="panel talk-panel" aria-label="Voice talk">
      <h2>Talk</h2>
      <p className="hint">
        ElevenAgents for <strong>{botName}</strong>: client tools navigate the glass shell;
        Worker webhook tools (8A) hit the same APIs as the UI. Spend still goes through
        trust → verify → policy → approval.
      </p>
      <ul className="talk-tools" aria-label="Client tools">
        {defs.map((tool) => (
          <li key={tool.name}>
            <code>{tool.name}</code>
            <span>{tool.description}</span>
          </li>
        ))}
      </ul>

      {agentId && clientTools ? (
        <TalkSession
          agentId={agentId}
          clientTools={clientTools}
          conversation={conversation}
          botName={botName}
        />
      ) : (
        <div className="live-actions">
          <button
            className="cta"
            type="button"
            disabled
            title="Set NEXT_PUBLIC_ELEVENLABS_AGENT_ID from the ElevenLabs agent created via /voice/agent"
          >
            Start voice session
          </button>
        </div>
      )}

      <div className="live-actions">
        <button className="ghost" type="button" disabled={!clientTools} onClick={() => demoTool('read_back')}>
          Read back
        </button>
        <button className="ghost" type="button" disabled={!clientTools} onClick={() => demoTool('confirm_dialog')}>
          Confirm demo
        </button>
      </div>

      <ol className="talk-transcript" aria-live="polite" aria-label="Conversation">
        {transcript.length === 0 ? (
          <li className="hint">No live events yet. Approvals, timeline, security, and voice messages appear here.</li>
        ) : transcript.map((entry) => (
          <li key={entry.id} data-role={entry.role}>
            <strong>{entry.role}</strong>
            <span>{entry.text}</span>
          </li>
        ))}
      </ol>
      {last ? (
        <p className="hint" role="status">
          Last tool <code>{last.name}</code>: {JSON.stringify(last.result)}
        </p>
      ) : null}
      {!agentId ? (
        <p className="hint">
          Create the ElevenLabs agent from runtime <code>/voice/agent</code>, then set
          <code> NEXT_PUBLIC_ELEVENLABS_AGENT_ID</code> to mount the live orb.
        </p>
      ) : null}
    </section>
  );
}
