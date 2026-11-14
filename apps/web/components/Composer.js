'use client';

import { useEffect, useRef, useState } from 'react';
import { AudioLines, Mic, Plus, Square } from 'lucide-react';
import SteelOrb from './SteelOrb';
import {
  DEFAULT_VOICE_SETTINGS,
  SPEED_MAX,
  SPEED_MIN,
  SPEED_STEP,
  VOICE_STORAGE_KEY,
  VOICES,
  parseVoiceSettings,
} from '../lib/voice-settings.mjs';

export default function Composer({ botName }) {
  const [talking, setTalking] = useState(false);
  const [note, setNote] = useState('');
  const [side, setSide] = useState('idle');
  const [settings, setSettings] = useState(DEFAULT_VOICE_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(false);
  const inputRef = useRef(() => 0);
  const outputRef = useRef(() => 0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const sideRef = useRef('idle');
  const sessionRef = useRef(null);
  const connectingRef = useRef(false);
  const rafRef = useRef(0);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(VOICE_STORAGE_KEY);
      if (raw) setSettings(parseVoiceSettings(JSON.parse(raw)));
    } catch {
      setSettings(DEFAULT_VOICE_SETTINGS);
    }
    setSettingsReady(true);
  }, []);

  useEffect(() => {
    if (!settingsReady) return;
    localStorage.setItem(VOICE_STORAGE_KEY, JSON.stringify(settings));
  }, [settings, settingsReady]);

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    sessionRef.current?.endSession?.().catch(() => {});
    sessionRef.current = null;
  }, []);

  function watchLevels() {
    const read = async () => {
      const live = sessionRef.current;
      if (!live) return;
      try {
        const input = Number(await live.getInputVolume()) || 0;
        const output = Number(await live.getOutputVolume()) || 0;
        if (sessionRef.current !== live) return;
        inputRef.current = () => input;
        outputRef.current = () => output;
      } catch {
        /* The session can end between the two reads. */
      }
      if (sessionRef.current === live) rafRef.current = requestAnimationFrame(watchLevels);
    };
    read();
  }

  async function stopSession() {
    const live = sessionRef.current;
    sessionRef.current = null;
    connectingRef.current = false;
    cancelAnimationFrame(rafRef.current);
    inputRef.current = () => 0;
    outputRef.current = () => 0;
    setTalking(false);
    setSide('idle');
    setNote('');
    if (live) await live.endSession?.().catch(() => {});
  }

  async function startSession() {
    if (connectingRef.current || sessionRef.current) return;
    connectingRef.current = true;
    setTalking(true);
    setNote('Connecting');
    setSide('idle');
    try {
      const response = await fetch('/api/voice/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsRef.current),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'voice_failed');
      const { Conversation } = await import('@elevenlabs/client');
      const live = await Conversation.startSession({
        conversationToken: payload.token,
        overrides: { tts: { voiceId: payload.voiceId, speed: payload.speed } },
        onModeChange: ({ mode }) => {
          if (sessionRef.current !== live) return;
          const next = mode === 'speaking' ? 'agent' : 'user';
          sideRef.current = next;
          setSide(next);
          setNote(mode === 'speaking' ? `${botName} is speaking` : 'Listening');
        },
        onError: () => {
          if (sessionRef.current === live) setNote('The voice session hit an error.');
        },
        onDisconnect: () => {
          if (sessionRef.current !== live) return;
          sessionRef.current = null;
          setTalking(false);
          setSide('idle');
        },
      });
      if (!connectingRef.current) {
        await live.endSession?.().catch(() => {});
        return;
      }
      sessionRef.current = live;
      setNote('Listening');
      rafRef.current = requestAnimationFrame(watchLevels);
    } catch (error) {
      setTalking(false);
      setSide('idle');
      setNote(voiceFailureNote(error));
    } finally {
      connectingRef.current = false;
    }
  }

  const caption = side === 'agent' ? `${botName} is speaking` : (note || 'Listening');

  return (
    <div className="talk-dock">
      {talking ? (
        <div className="talk-orb">
          <SteelOrb inputLevel={() => inputRef.current()} outputLevel={() => outputRef.current()} />
          <p role="status">{caption}</p>
        </div>
      ) : null}
      {settingsReady ? (
        <div className="voice-tune">
          <label>
            Voice
            <select
              title="The live session uses this voice."
              disabled={talking}
              value={settings.voiceId}
              onChange={event => setSettings(current => parseVoiceSettings({ ...current, voiceId: event.target.value }))}
            >
              {VOICES.map(voice => (
                <option key={voice.id} value={voice.id}>{voice.name}</option>
              ))}
            </select>
          </label>
          <label>
            Speed
            <input
              title="The live session uses this speed."
              disabled={talking}
              aria-valuetext={`${settings.speed.toFixed(2)}x`}
              type="range"
              min={SPEED_MIN}
              max={SPEED_MAX}
              step={SPEED_STEP}
              value={settings.speed}
              onChange={event => setSettings(current => parseVoiceSettings({ ...current, speed: event.target.value }))}
            />
            <span className="speed-read">{settings.speed.toFixed(2)}x</span>
          </label>
        </div>
      ) : <div className="voice-tune" aria-hidden="true" />}
      {note && !talking ? <p className="voice-note" role="status">{note}</p> : null}
      <form className="composer" aria-label="Voice session" onSubmit={event => event.preventDefault()}>
        <button type="button" className="icon-btn" aria-label="Add" disabled title="Attachments are not wired yet">
          <Plus size={18} strokeWidth={1.75} />
        </button>
        <input
          aria-label={`Message ${botName}`}
          placeholder={`Message ${botName}`}
          readOnly
          title="Chat sends through the same approval path. This field is not live yet."
        />
        <button type="button" className="icon-btn" aria-label="Microphone" disabled title="The talk button uses the microphone.">
          <Mic size={18} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className={`icon-btn voice${talking ? ' is-on' : ''}`}
          aria-label={talking ? 'Stop voice session' : 'Start voice session'}
          aria-pressed={talking}
          onClick={() => { if (sessionRef.current || talking) stopSession(); else startSession(); }}
        >
          {talking ? <Square size={16} strokeWidth={1.75} /> : <AudioLines size={18} strokeWidth={1.75} />}
        </button>
      </form>
    </div>
  );
}

function voiceFailureNote(error) {
  if (error?.name === 'NotAllowedError') return 'Microphone is off, so the session stayed closed.';
  if (error?.message === 'voice_unconfigured') return 'Voice is not configured on the server.';
  if (error?.message === 'voice_rejected') return 'The voice service refused the session. Publish the agent and turn on Voice ID and Speed overrides.';
  if (error?.message === 'voice_unreachable') return 'The voice service did not respond.';
  return 'The voice session did not start.';
}
