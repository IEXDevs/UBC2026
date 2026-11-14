'use client';

import { useMemo, useState } from 'react';
import { voiceToolDefinitions } from '../lib/voice-client-tools.mjs';

/**
 * ElevenAgents Talk surface (Isaac / 8B client tools).
 * When `clientTools` is provided, spoken actions can open bots, focus Live View,
 * confirm, and read back — still no parallel spend path.
 * Full @elevenlabs/react conversation mounts when NEXT_PUBLIC_ELEVENLABS_AGENT_ID is set (8A).
 */
export default function TalkStub({
  botName = 'agent',
  clientTools = null,
  onVoiceEvent = null,
}) {
  const [last, setLast] = useState(null);
  const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID || '';
  const defs = useMemo(() => voiceToolDefinitions(), []);
  const ready = Boolean(clientTools) && Boolean(agentId);

  async function demoTool(name) {
    if (!clientTools?.[name]) return;
    const params = name === 'open_bot' ? { name: botName }
      : name === 'confirm_dialog' ? { prompt: `Confirm action for ${botName}?`, actionId: 'demo' }
        : name === 'read_back' ? { topic: 'overview' }
          : { };
    const result = await clientTools[name](params);
    setLast({ name, result });
    if (typeof onVoiceEvent === 'function') onVoiceEvent({ name, result });
  }

  return (
    <section className="panel talk-panel" aria-label="Voice talk">
      <h2>Talk</h2>
      <p className="hint">
        ElevenAgents client tools for <strong>{botName}</strong>: open bot, Live View,
        confirm, read-back. Spend still goes through trust → verify → policy → approval.
      </p>
      <ul className="talk-tools" aria-label="Client tools">
        {defs.map((tool) => (
          <li key={tool.name}>
            <code>{tool.name}</code>
            <span>{tool.description}</span>
          </li>
        ))}
      </ul>
      <div className="live-actions">
        <button
          className="cta"
          type="button"
          disabled={!ready}
          title={ready ? 'Start ElevenAgents session' : 'Requires NEXT_PUBLIC_ELEVENLABS_AGENT_ID + client tools'}
        >
          Start voice session
        </button>
        <button className="ghost" type="button" disabled={!clientTools} onClick={() => demoTool('read_back')}>
          Read back
        </button>
        <button className="ghost" type="button" disabled={!clientTools} onClick={() => demoTool('confirm_dialog')}>
          Confirm demo
        </button>
      </div>
      {last ? (
        <p className="hint" role="status">
          Last tool <code>{last.name}</code>: {JSON.stringify(last.result)}
        </p>
      ) : null}
    </section>
  );
}
