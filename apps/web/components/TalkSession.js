'use client';

import { useEffect, useState } from 'react';
import { ConversationProvider, useConversation } from '@elevenlabs/react';

/**
 * Live ElevenAgents session (Isaac / 8B) — mounts only when agentId is set.
 * Client tools stay in the glass shell; webhook tools hit Alex / 8A Worker routes.
 */
function TalkSessionInner({
  agentId,
  clientTools,
  conversation,
  botName,
}) {
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(false);
  const session = useConversation({
    clientTools: clientTools || {},
    onConnect: () => {
      conversation?.push({ kind: 'voice', text: `Voice connected for ${botName}` });
    },
    onDisconnect: () => {
      conversation?.push({ kind: 'voice', text: 'Voice disconnected' });
    },
    onError: (err) => {
      setError(err?.message || 'voice_error');
      conversation?.push({ kind: 'voice', text: `Voice error: ${err?.message || 'unknown'}` });
    },
    onMessage: (message) => {
      const text = typeof message?.message === 'string'
        ? message.message
        : typeof message?.text === 'string'
          ? message.text
          : null;
      if (!text) return;
      if (message?.source === 'user' || message?.role === 'user') conversation?.pushUser(text);
      else conversation?.pushAssistant(text);
    },
  });

  async function start() {
    setError(null);
    setStarting(true);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      await session.startSession({ agentId });
    } catch (err) {
      setError(err?.message || 'start_failed');
    } finally {
      setStarting(false);
    }
  }

  async function stop() {
    try {
      await session.endSession();
    } catch {
      // ignore
    }
  }

  useEffect(() => () => {
    session.endSession?.().catch(() => {});
  }, [session]);

  const status = session.status || 'disconnected';
  const connected = status === 'connected';

  return (
    <div className="live-actions">
      <button
        className="cta"
        type="button"
        disabled={starting || connected}
        onClick={start}
      >
        {starting ? 'Starting…' : connected ? 'Voice live' : 'Start voice session'}
      </button>
      <button className="ghost" type="button" disabled={!connected} onClick={stop}>
        End session
      </button>
      <span className="hint">Status: {status}{session.mode ? ` · ${session.mode}` : ''}</span>
      {error ? <p className="hint" role="alert">{error}</p> : null}
    </div>
  );
}

export default function TalkSession(props) {
  if (!props.agentId) return null;
  return (
    <ConversationProvider>
      <TalkSessionInner {...props} />
    </ConversationProvider>
  );
}
