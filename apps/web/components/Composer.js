'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AudioLines, Mic, MicOff, Minimize2, Plus, Settings, Square } from 'lucide-react';
import ChatBubbles from './ChatBubbles';
import CrystalizedBall from './CrystalizedBall';
import Stepper, { Step } from './Stepper';
import { clampFloat, FLOAT_SIZE, FLOAT_STORAGE_KEY } from '../lib/voice-float.mjs';
import {
  DEFAULT_VOICE_SETTINGS,
  SPEED_MAX,
  SPEED_MIN,
  SPEED_STEP,
  VOICE_STORAGE_KEY,
  VOICES,
  parseVoiceSettings,
} from '../lib/voice-settings.mjs';

const LEAVE_MS = 760;

export default function Composer({ botName, lines = [], onLine, hidden = false }) {
  const [presence, setPresence] = useState('off');
  const [mode, setMode] = useState('full');
  const [note, setNote] = useState('');
  const [muted, setMuted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [warm, setWarm] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_VOICE_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(false);
  const [stage, setStage] = useState(null);
  const [body, setBody] = useState(null);
  const [place, setPlace] = useState({ x: 24, y: 24 });
  const dockRef = useRef(null);
  const settingsRef = useRef(settings);
  const presenceRef = useRef('off');
  const sessionRef = useRef(null);
  const connectingRef = useRef(false);
  const placeRef = useRef(place);
  const leaveTimer = useRef(0);
  settingsRef.current = settings;
  placeRef.current = place;

  function setPhase(next) {
    presenceRef.current = next;
    setPresence(next);
  }

  useEffect(() => {
    setStage(dockRef.current?.closest('.stage') ?? null);
    setBody(document.body);
    setPlace(readPlace());
  }, []);

  useEffect(() => {
    if (presence !== 'enter') return undefined;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        if (presenceRef.current === 'enter') setPhase('on');
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [presence]);

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

  useEffect(() => {
    if (!body) return;
    localStorage.setItem(FLOAT_STORAGE_KEY, JSON.stringify(place));
  }, [place, body]);

  useEffect(() => () => {
    window.clearTimeout(leaveTimer.current);
    sessionRef.current?.endSession?.().catch(() => {});
    sessionRef.current = null;
  }, []);

  function pushLine(role, text) {
    const spoken = typeof text === 'string' ? text.trim() : '';
    if (!spoken) return;
    onLine?.({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, role, text: spoken });
  }

  function finishLeave(keepNote) {
    const live = sessionRef.current;
    sessionRef.current = null;
    connectingRef.current = false;
    setMuted(false);
    setSettingsOpen(false);
    setWarm(false);
    setMode('full');
    if (!keepNote) setNote('');
    setPhase('off');
    if (live) live.endSession?.().catch(() => {});
  }

  function closeStage(keepNote = false) {
    if (presenceRef.current === 'off' || presenceRef.current === 'leave') return;
    setPhase('leave');
    setSettingsOpen(false);
    setWarm(false);
    window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => finishLeave(keepNote), LEAVE_MS);
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    sessionRef.current?.setMicMuted?.(next);
  }

  async function startSession() {
    if (sessionRef.current || connectingRef.current) {
      setMode('full');
      return;
    }
    if (presenceRef.current !== 'off') {
      if (presenceRef.current !== 'leave') setMode('full');
      return;
    }
    connectingRef.current = true;
    setMode('full');
    setPhase('enter');
    setNote('');
    setMuted(false);
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
        onMessage: ({ message, role }) => {
          if (sessionRef.current !== live) return;
          pushLine(role === 'user' ? 'user' : 'agent', message);
        },
        onError: () => {
          if (sessionRef.current === live) setNote('The voice session hit an error.');
        },
        onDisconnect: () => {
          if (sessionRef.current !== live) return;
          sessionRef.current = null;
          closeStage();
        },
      });
      if (!connectingRef.current) {
        await live.endSession?.().catch(() => {});
        return;
      }
      sessionRef.current = live;
    } catch (error) {
      setNote(voiceFailureNote(error));
      closeStage(true);
    } finally {
      connectingRef.current = false;
    }
  }

  function onOrbPointerDown(event) {
    if (event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = placeRef.current;
    let moved = false;
    function move(next) {
      const dx = next.clientX - startX;
      const dy = next.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 6) return;
      moved = true;
      setDragging(true);
      setWarm(false);
      const bounds = { vw: window.innerWidth, vh: window.innerHeight };
      setPlace(clampFloat(origin.x + dx, origin.y + dy, bounds));
    }
    function up() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragging(false);
      if (!moved) setMode('full');
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const voiceName = VOICES.find(voice => voice.id === settings.voiceId)?.name ?? 'Voice';
  const live = presence !== 'off';
  const stageOpen = mode === 'full' && presence === 'on';
  const floatOpen = mode === 'mini' && (presence === 'on' || presence === 'enter');

  const stageNode = live && stage ? createPortal(
    <div className={`voice-stage${stageOpen ? ' is-open' : ''}`} role="dialog" aria-hidden={!stageOpen} aria-label={`Talk with ${botName}`}>
      <div className="voice-orb">
        {mode === 'full' ? <CrystalizedBall preset="eclipse" color="#f4f4f5" size={0.78} theme="dark" interactive /> : null}
      </div>
      <div className="voice-script" aria-live="polite">
        <ChatBubbles lines={lines} botName={botName} />
        {note ? <p className="voice-note">{note}</p> : null}
      </div>
      {settingsOpen && stageOpen ? (
        <div className="voice-sheet">
          <VoiceSettings settings={settings} onChange={setSettings} />
        </div>
      ) : null}
      <div className="voice-controls">
        <button type="button" className={`icon-btn${muted ? ' is-on' : ''}`} aria-label={muted ? 'Unmute' : 'Mute'} aria-pressed={muted} onClick={toggleMute}>
          {muted ? <MicOff size={18} strokeWidth={1.75} /> : <Mic size={18} strokeWidth={1.75} />}
        </button>
        <button type="button" className={`icon-btn${settingsOpen ? ' is-on' : ''}`} aria-label="Voice settings" aria-pressed={settingsOpen} onClick={() => setSettingsOpen(open => !open)}>
          <Settings size={18} strokeWidth={1.75} />
        </button>
        <button type="button" className="icon-btn" aria-label="Minimize voice" onClick={() => { setSettingsOpen(false); setMode('mini'); }}>
          <Minimize2 size={16} strokeWidth={1.75} />
        </button>
        <button type="button" className="icon-btn" aria-label="End voice" onClick={() => closeStage()}>
          <Square size={16} strokeWidth={1.75} />
        </button>
      </div>
    </div>,
    stage,
  ) : null;

  const floatNode = live && body ? createPortal(
    <div
      className={`voice-float${floatOpen ? ' is-open' : ''}${warm && !dragging ? ' is-warm' : ''}${dragging ? ' is-dragging' : ''}${place.x < 460 ? ' is-flip' : ''}`}
      inert={floatOpen ? undefined : true}
      style={{ left: place.x, top: place.y, width: FLOAT_SIZE }}
      onMouseEnter={() => { if (!dragging) setWarm(true); }}
      onMouseLeave={() => setWarm(false)}
    >
      <div className="voice-float-menu">
        <div className="voice-float-menu-clip">
          <Stepper
            showFooter={false}
            frame
            theme="dark"
            accentColor="#f4f4f5"
            radius={18}
            width={440}
            transition="slide"
          >
            <Step title="Mute">
              <button type="button" className="voice-step-action" onClick={toggleMute}>
                {muted ? <MicOff size={16} strokeWidth={1.75} /> : <Mic size={16} strokeWidth={1.75} />}
                {muted ? 'Unmute' : 'Mute'}
              </button>
            </Step>
            <Step title="Voice">
              <VoiceSettings settings={settings} onChange={setSettings} />
            </Step>
            <Step title="Session">
              <div className="voice-step-row">
                <button type="button" className="voice-step-action" onClick={() => setMode('full')}>Full view</button>
                <button type="button" className="voice-step-action is-quiet" onClick={() => closeStage()}>End</button>
              </div>
            </Step>
          </Stepper>
        </div>
      </div>
      <button
        type="button"
        className="voice-float-orb"
        aria-label={`Voice with ${botName}. Drag to move, click for full view.`}
        onPointerDown={onOrbPointerDown}
      >
        {mode === 'mini' ? <CrystalizedBall preset="eclipse" color="#f4f4f5" size={0.42} theme="dark" interactive={false} /> : null}
      </button>
    </div>,
    body,
  ) : null;

  return (
    <div className={`talk-dock${hidden ? ' is-away' : ''}`} ref={dockRef}>
      {stageNode}
      {floatNode}
      {note && presence === 'off' ? <p className="voice-note" role="status">{note}</p> : null}
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
        <button
          type="button"
          className={`icon-btn voice${live ? ' is-on' : ''}`}
          aria-label={live ? 'Open voice' : 'Start voice session'}
          title={voiceName}
          onClick={startSession}
        >
          <AudioLines size={18} strokeWidth={1.75} />
        </button>
      </form>
    </div>
  );
}

function VoiceSettings({ settings, onChange }) {
  return (
    <div className="voice-settings">
      <p>Voice</p>
      <div className="voice-picks">
        {VOICES.map(voice => (
          <button
            key={voice.id}
            type="button"
            className={voice.id === settings.voiceId ? 'is-on' : ''}
            aria-pressed={voice.id === settings.voiceId}
            onClick={() => onChange(current => parseVoiceSettings({ ...current, voiceId: voice.id }))}
          >
            {voice.name}
          </button>
        ))}
      </div>
      <label>
        Speed
        <input
          aria-label="Speed"
          aria-valuetext={`${settings.speed.toFixed(2)}x`}
          type="range"
          min={SPEED_MIN}
          max={SPEED_MAX}
          step={SPEED_STEP}
          value={settings.speed}
          onChange={event => onChange(current => parseVoiceSettings({ ...current, speed: event.target.value }))}
        />
        <span>{settings.speed.toFixed(2)}x</span>
      </label>
    </div>
  );
}

function readPlace() {
  const bounds = { vw: window.innerWidth, vh: window.innerHeight };
  try {
    const raw = JSON.parse(localStorage.getItem(FLOAT_STORAGE_KEY) || 'null');
    if (raw && Number.isFinite(raw.x) && Number.isFinite(raw.y)) return clampFloat(raw.x, raw.y, bounds);
  } catch {
    /* keep the default corner */
  }
  return clampFloat(bounds.vw - 108, bounds.vh - 210, bounds);
}

function voiceFailureNote(error) {
  if (error?.name === 'NotAllowedError') return 'Microphone is off, so the session stayed closed.';
  if (error?.message === 'voice_unconfigured') return 'Voice is not configured on the server.';
  if (error?.message === 'voice_rejected') return 'The voice service refused the session. Publish the agent and turn on Voice ID and Speed overrides.';
  if (error?.message === 'voice_unreachable') return 'The voice service did not respond.';
  return 'The voice session did not start.';
}
