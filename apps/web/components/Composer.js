'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Mic, MicOff, Minimize2, Settings, Square } from 'lucide-react';
import { Attachment01Icon } from '@hugeicons/core-free-icons';
import ChatBubbles from './ChatBubbles';
import ContextUsage from './ContextUsage';
import Attachments, { isImageFile } from './Attachments';
import { Suggestion } from './ai/elements';
import CrystalizedBall from './CrystalizedBall';
import VoiceHalo from './VoiceHalo';
import PromptBar from './PromptBar';
import Stepper, { Step } from './Stepper';
import { clampFloat, FLOAT_SIZE, FLOAT_STORAGE_KEY } from '../lib/voice-float.mjs';
import { mentionIn, recipientHint } from '../lib/profile.mjs';
import {
  DEFAULT_VOICE_SETTINGS,
  SPEED_MAX,
  SPEED_MIN,
  SPEED_STEP,
  VOICE_STORAGE_KEY,
  VOICES,
  parseVoiceSettings,
} from '../lib/voice-settings.mjs';
import { sendBotChat } from '../lib/runtime-data.mjs';

const LEAVE_MS = 760;
const PROMPT_SOURCES = [
  { key: 'files', name: 'Photos & files', description: 'Upload from this device', icon: Attachment01Icon, attach: true },
];
const PROMPT_MODELS = [
  { key: 'muse-spark', name: 'Muse Spark', tag: 'Chat' },
];
const PROMPT_EFFORTS = ['Low', 'Medium', 'High', 'Extra', 'Max'];
const SUGGESTIONS = [
  'What should this agent watch?',
  'Summarize the latest activity',
  'Show the open positions',
];

export default function Composer({
  botId = null,
  botName,
  botGoal = '',
  botType = 'trading',
  ownerId = null,
  lines = [],
  onLine,
  onThinking,
  onVoiceSpan = null,
  hidden = false,
  resolveMention = null,
  usage = null,
  onAttach = null,
}) {
  const [presence, setPresence] = useState('off');
  const [mode, setMode] = useState('full');
  const [note, setNote] = useState('');
  const [muted, setMuted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [warm, setWarm] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_VOICE_SETTINGS);
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState([]);
  const fileRef = useRef(null);
  const [mention, setMention] = useState('');
  const [thinking, setThinking] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [stage, setStage] = useState(null);
  const [body, setBody] = useState(null);
  const [place, setPlace] = useState({ x: 24, y: 24 });
  const dockRef = useRef(null);
  const settingsRef = useRef(settings);
  const presenceRef = useRef('off');
  const sessionRef = useRef(null);
  const modeRef = useRef('listening');
  const vadRef = useRef(0);
  const connectingRef = useRef(false);
  const sendingRef = useRef(false);
  const placeRef = useRef(place);
  const leaveTimer = useRef(0);
  const thinkTimer = useRef(0);
  const voiceStarted = useRef(0);
  const onVoiceSpanRef = useRef(onVoiceSpan);
  onVoiceSpanRef.current = onVoiceSpan;
  settingsRef.current = settings;
  placeRef.current = place;

  function setPhase(next) {
    presenceRef.current = next;
    setPresence(next);
  }

  function commitVoice() {
    const started = voiceStarted.current;
    if (!started) return;
    voiceStarted.current = 0;
    onVoiceSpanRef.current?.(performance.now() - started);
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
    window.clearTimeout(thinkTimer.current);
    onThinking?.(false);
    const started = voiceStarted.current;
    if (started) {
      voiceStarted.current = 0;
      onVoiceSpanRef.current?.(performance.now() - started);
    }
    sessionRef.current?.endSession?.().catch(() => {});
    sessionRef.current = null;
  }, []);

  useEffect(() => {
    const token = mentionIn(draft);
    if (!token || typeof resolveMention !== 'function') {
      setMention('');
      return undefined;
    }
    let stop = false;
    resolveMention(token).then((recipient) => {
      if (!stop) setMention(recipientHint(recipient));
    }).catch(() => {
      if (!stop) setMention('');
    });
    return () => { stop = true; };
  }, [draft, resolveMention]);

  function addFiles(list) {
    const room = Math.max(0, 10 - files.length);
    const next = [...list].slice(0, room).map(file => ({
      id: `${file.name}-${file.size}-${file.lastModified}`,
      name: file.name,
      size: file.size,
      type: file.type || 'file',
      url: isImageFile({ name: file.name, type: file.type }) ? URL.createObjectURL(file) : '',
    }));
    if (next.length === 0) return;
    setFiles(current => [...current, ...next].slice(0, 10));
    onAttach?.(next.map(file => ({ ...file, addedAt: Date.now() })));
  }

  function dropFile(id) {
    setFiles(current => current.filter(file => file.id !== id));
  }

  function pickFiles() {
    const input = fileRef.current;
    if (!input) return [];
    return new Promise((resolve) => {
      let settled = false;
      const finish = (names) => {
        if (settled) return;
        settled = true;
        input.removeEventListener('change', changed);
        input.removeEventListener('cancel', dismissed);
        window.removeEventListener('focus', cancelled);
        resolve(names);
      };
      const changed = () => {
        const list = [...(input.files || [])];
        input.value = '';
        addFiles(list);
        finish([]);
      };
      const cancelled = () => {
        window.setTimeout(() => finish([]), 500);
      };
      const dismissed = () => finish([]);
      input.addEventListener('change', changed);
      input.addEventListener('cancel', dismissed);
      input.click();
      requestAnimationFrame(() => window.addEventListener('focus', cancelled, { once: true }));
    });
  }

  async function sendMessage(text) {
    const spokenText = typeof text === 'string' ? text.trim() : draft.trim();
    const attached = files.map(file => file.name).join(', ');
    const spoken = attached ? `${spokenText}${spokenText ? '\n' : ''}${attached}` : spokenText;
    if (!spoken || sendingRef.current) return;
    const prior = lines;
    pushLine('user', spoken);
    if (mention) pushLine('assistant', mention);
    setDraft('');
    setFiles([]);
    setMention('');
    setThinking(true);
    onThinking?.(true);
    window.clearTimeout(thinkTimer.current);
    sendingRef.current = true;
    try {
      if (!ownerId || !botId) {
        pushLine('agent', ownerId
          ? 'Pick a bot before chatting.'
          : 'Sign in to chat with this bot.');
        return;
      }
      const result = await sendBotChat({
        ownerId,
        botId,
        message: spoken,
        history: prior,
        name: botName,
        goal: botGoal,
        type: botType,
      });
      if (result.ok) {
        pushLine('agent', result.reply);
      } else {
        pushLine('agent', chatFailureNote(result.error));
      }
    } catch {
      pushLine('agent', chatFailureNote('network'));
    } finally {
      sendingRef.current = false;
      setThinking(false);
      onThinking?.(false);
    }
  }

  function pushLine(role, text) {
    const spoken = typeof text === 'string' ? text.trim() : '';
    if (!spoken) return;
    onLine?.({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, role, text: spoken });
  }

  function finishLeave(keepNote) {
    commitVoice();
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
        onModeChange: ({ mode }) => {
          if (sessionRef.current === live) modeRef.current = mode;
        },
        onVadScore: ({ vadScore }) => {
          if (sessionRef.current === live) vadRef.current = vadScore;
        },
        onError: () => {
          if (sessionRef.current === live) setNote('The voice session hit an error.');
        },
        onDisconnect: () => {
          if (sessionRef.current !== live) return;
          sessionRef.current = null;
          modeRef.current = 'listening';
          vadRef.current = 0;
          closeStage();
        },
      });
      if (!connectingRef.current) {
        await live.endSession?.().catch(() => {});
        return;
      }
      sessionRef.current = live;
      voiceStarted.current = performance.now();
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

  const live = presence !== 'off';
  const stageOpen = mode === 'full' && presence === 'on';
  const floatOpen = mode === 'mini' && (presence === 'on' || presence === 'enter');

  const stageNode = live && stage ? createPortal(
    <div className={`voice-stage${stageOpen ? ' is-open' : ''}`} role="dialog" aria-hidden={!stageOpen} aria-label={`Talk with ${botName}`}>
      <div className="voice-orb">
        {mode === 'full' ? <TalkOrb sessionRef={sessionRef} modeRef={modeRef} vadRef={vadRef} size={0.78} interactive /> : null}
      </div>
      <div className="voice-script" aria-live="polite">
        <ChatBubbles lines={lines} botName={botName} thinking={thinking} />
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
        <button type="button" className="icon-btn is-stop" aria-label="Stop voice" onClick={() => closeStage()}>
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
        {mode === 'mini' ? <TalkOrb sessionRef={sessionRef} modeRef={modeRef} vadRef={vadRef} size={0.42} interactive={false} /> : null}
      </button>
    </div>,
    body,
  ) : null;

  return (
    <div className={`talk-dock${hidden ? ' is-away' : ''}`} ref={dockRef}>
      {stageNode}
      {floatNode}
      {note && presence === 'off' ? <p className="voice-note" role="status">{note}</p> : null}
      {mention ? <p className="mention-hint" role="status">{mention}</p> : null}
      {lines.length === 0 ? (
        <div className="entry-suggestions">
          {SUGGESTIONS.map((text) => (
            <Suggestion key={text} onClick={() => { void sendMessage(text); }}>{text}</Suggestion>
          ))}
        </div>
      ) : null}
      <div className="composer" aria-label="Message the agent">
        <input ref={fileRef} className="sr-only" type="file" multiple aria-label="Attach files" />
        <PromptBar
          placeholder={`Message ${botName}`}
          label={`Message ${botName}`}
          sources={PROMPT_SOURCES}
          models={PROMPT_MODELS}
          efforts={PROMPT_EFFORTS}
          defaultEffort="Medium"
          busy={thinking}
          background="transparent"
          color="#f5f5f5"
          menuBackground="#27272a"
          sparkColor="#f5f5f5"
          width={1200}
          radius={20}
          onDraftChange={setDraft}
          onAttach={pickFiles}
          extraReady={files.length > 0}
          chips={files.length > 0 ? <Attachments files={files} onRemove={dropFile} /> : null}
          onSend={(text) => sendMessage(text)}
          accessory={usage ? <ContextUsage usage={usage} /> : null}
          endSlot={(
            <button
              type="button"
              className={`voice-mode${live ? ' is-on' : ''}`}
              aria-label={live ? 'Stop voice' : 'Voice'}
              aria-pressed={live}
              onMouseDown={event => event.preventDefault()}
              onClick={() => { if (live) closeStage(); else startSession(); }}
            >
              <span className="voice-mode-bars" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </button>
          )}
        />
      </div>
    </div>
  );
}

function TalkOrb({ sessionRef, modeRef, vadRef, size, interactive }) {
  const [talk, setTalk] = useState({ side: 'idle', level: 0 });

  useEffect(() => {
    let frame = 0;
    let last = 0;
    const tick = now => {
      frame = requestAnimationFrame(tick);
      if (now - last < 70) return;
      last = now;
      const session = sessionRef.current;
      const mode = modeRef.current;
      const vad = Math.max(0, Math.min(1, Number(vadRef.current) || 0));
      const output = Math.max(0, Math.min(1, Number(session?.getOutputVolume?.() ?? 0)));
      const input = Math.max(0, Math.min(1, Number(session?.getInputVolume?.() ?? 0)));
      const agent = Math.max(output, mode === 'speaking' ? Math.max(output, 0.62) : 0);
      const user = Math.max(input, mode === 'listening' ? vad : 0);
      const side = agent > 0.08 && agent >= user ? 'agent' : user > 0.08 ? 'user' : 'idle';
      const level = side === 'idle' ? 0 : Math.max(agent, user);
      setTalk(prev => (prev.side === side && Math.abs(prev.level - level) < 0.04 ? prev : { side, level }));
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [sessionRef, modeRef, vadRef]);

  const color = talk.side === 'agent' ? '#6cb2ff' : talk.side === 'user' ? '#ff9a4a' : '#e7edf2';
  const ball = (
    <CrystalizedBall
      preset="eclipse"
      color={color}
      size={size}
      theme="dark"
      interactive={interactive}
      speed={0.42 + talk.level * 2.8}
      dustSpeed={0.5 + talk.level * 2.2}
      flares={0.22 + talk.level * 0.95}
      crackle={0.28 + talk.level * 0.75}
      motion={talk.side === 'user' ? 'rise' : talk.side === 'agent' ? 'orbit' : 'drift'}
    />
  );
  if (size < 0.6) return ball;
  return (
    <VoiceHalo level={talk.level} color={color} size={340}>
      {ball}
    </VoiceHalo>
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

function chatFailureNote(code) {
  if (code === 'openrouter_not_configured') {
    return 'Add MODEL_API_KEY=LLM_… (Meta Model API) to the root .env.local and restart Next.';
  }
  if (code === 'openrouter_unauthorized') {
    return 'Meta Model API rejected the key. Check MODEL_API_KEY in root .env.local (should start with LLM_).';
  }
  if (code === 'openrouter_bad_request') return 'The model request was invalid. Try a shorter message.';
  if (code === 'openrouter_failed' || code === 'openrouter_unavailable') {
    return 'The model call failed. Try again in a moment.';
  }
  if (code === 'not_found' || code === 'bot_not_found') return 'This bot was not found for your account.';
  if (code === 'invalid_request') return 'Sign in to chat with this bot.';
  if (code === 'network') return 'Could not reach the chat API for a reply.';
  return 'I could not reply just now.';
}
