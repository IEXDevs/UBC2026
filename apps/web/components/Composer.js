'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Mic, MicOff, Minimize2, Maximize2, Square } from 'lucide-react';
import { Attachment01Icon } from '@hugeicons/core-free-icons';
import ChatBubbles from './ChatBubbles';
import ContextUsage from './ContextUsage';
import Attachments, { isImageFile } from './Attachments';
import { Suggestion } from './ai/elements';
import GradientAscii from './GradientAscii';
import { Orb } from '@yogesharc/thinking-orbs';
import { orbSpeed, voiceOrbLook } from '../lib/voice-orb.mjs';
import WakeSlider from './WakeSlider';
import GlideSelect from './GlideSelect';
import PromptBar from './PromptBar';
import ProviderAdd from './ProviderAdd';
import { clampFloat, FLOAT_SIZE, FLOAT_STORAGE_KEY } from '../lib/voice-float.mjs';
import { createMicGate } from '../lib/mic-gate.mjs';
import {
  dictationBusyError,
  startBrowserDictation,
} from '../lib/dictation.mjs';
import { mentionIn, recipientHint } from '../lib/profile.mjs';
import AddressCopy from './AddressCopy';
import {
  DEFAULT_VOICE_SETTINGS,
  SPEED_MAX,
  SPEED_MIN,
  SPEED_STEP,
  VOICE_STORAGE_KEY,
  LANGUAGES,
  VOICES,
  parseVoiceSettings,
  voiceOverrides,
} from '../lib/voice-settings.mjs';
import { SPEND_PERMISSION_KEY, parsePermission, permissionById } from '../lib/spend-permission.mjs';
import { fallbackThinkingCatalog } from '../lib/thinking-levels.mjs';
import { sendBotChat } from '../lib/runtime-data.mjs';
import { startVoiceConversation } from '../lib/voice-session.mjs';
import { classifyVoiceDisconnect, voiceErrorNote } from '../lib/voice-disconnect.mjs';
import { canonicalFileName, displayFileName } from '../lib/file-name.mjs';
import { rememberSessionFile } from '../lib/file-session.mjs';
import { readDeskGrant } from '../lib/desk-lock.mjs';
import { stageKind } from '../lib/file-view.mjs';
import { clipOwnerMessage, contextWindowFor } from '../lib/context-usage.mjs';

const LEAVE_MS = 760;
const PROMPT_SOURCES = [
  { key: 'files', name: 'Photos & files', description: 'Upload from this device', icon: Attachment01Icon, attach: true },
];
function promptModels(rows) {
  const source = Array.isArray(rows) && rows.length > 0 ? rows : fallbackThinkingCatalog();
  return source.map(model => ({
    key: model.id,
    name: model.name,
    tag: 'Chat',
    levels: Array.isArray(model.levels) ? model.levels : [],
    contextWindow: contextWindowFor(model.id, model.contextWindow),
  }));
}
const SUGGESTIONS = [
  'What should this agent watch?',
  'Summarize the latest activity',
  'Show the open positions',
];
const HOSTED_IMAGE_BYTES = 400_000;

function previewUrl(file) {
  const image = isImageFile(file);
  const type = file?.type || '';
  const kind = stageKind(file);
  const playable = image || type.startsWith('video/') || type.startsWith('audio/') || kind === 'pdf' || kind === 'doc' || kind === 'code';
  if (!playable || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return Promise.resolve('');
  if (image && file.size > 0 && file.size <= HOSTED_IMAGE_BYTES && typeof FileReader !== 'undefined') {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const value = typeof reader.result === 'string' ? reader.result : '';
        resolve(value.startsWith('data:image/') ? value : '');
      };
      reader.onerror = () => resolve('');
      try {
        reader.readAsDataURL(file);
      } catch {
        resolve('');
      }
    });
  }
  try {
    return Promise.resolve(URL.createObjectURL(file));
  } catch {
    return Promise.resolve('');
  }
}

export default function Composer({
  botId = null,
  botName,
  botGoal = '',
  botType = 'trading',
  ownerId = null,
  shellBots = null,
  shellWallets = null,
  shellBalanceLabel = null,
  fileCatalog = null,
  getAccessToken = null,
  lines = [],
  onLine,
  onThinking,
  onVoiceSpan = null,
  hidden = false,
  resolveMention = null,
  usage = null,
  onAttach = null,
  onEditLine = null,
  onPatchLine = null,
  onConfirm = null,
  onBindAccess = null,
  clientTools = null,
  onContextWindow = null,
}) {
  const [presence, setPresence] = useState('off');
  const [mode, setMode] = useState('full');
  const [note, setNote] = useState('');
  const [muted, setMuted] = useState(false);
  const [warm, setWarm] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_VOICE_SETTINGS);
  const [permission, setPermission] = useState('ask');
  const [models, setModels] = useState(() => promptModels());
  const [chatModel, setChatModel] = useState(() => promptModels()[0]?.key || '');
  const [providerOpen, setProviderOpen] = useState(false);
  const [callName, setCallName] = useState('');
  const [callBotId, setCallBotId] = useState(null);
  const [speaker, setSpeaker] = useState('idle');
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState([]);
  const catalogRef = useRef(fileCatalog);
  catalogRef.current = fileCatalog;
  const fileRef = useRef(null);
  const [mention, setMention] = useState('');
  const [mentionCopy, setMentionCopy] = useState(null);
  const [thinking, setThinking] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [stage, setStage] = useState(null);
  const [body, setBody] = useState(null);
  const [settingsRoot, setSettingsRoot] = useState(null);
  const [place, setPlace] = useState({ x: 24, y: 24 });
  const dockRef = useRef(null);
  const settingsRef = useRef(settings);
  const permissionRef = useRef(permission);
  const modelRef = useRef(models[0]?.key || '');
  const effortRef = useRef(models[0]?.levels?.find(level => level.default)?.label || '');
  const modelsRef = useRef(models);
  const botIdRef = useRef(botId);
  const botNameRef = useRef(botName);
  const botGoalRef = useRef(botGoal);
  const botTypeRef = useRef(botType);
  const callBotRef = useRef(null);
  const presenceRef = useRef('off');
  const sessionRef = useRef(null);
  const micGate = useRef(null);
  if (!micGate.current) micGate.current = createMicGate();
  const dictationRef = useRef(null);
  const modeRef = useRef('listening');
  const vadRef = useRef(0);
  const connectingRef = useRef(false);
  const userEndedRef = useRef(false);
  const sendingRef = useRef(false);
  const placeRef = useRef(place);
  const leaveTimer = useRef(0);
  const warmTimer = useRef(0);
  const thinkTimer = useRef(0);
  const voiceStarted = useRef(0);
  const onVoiceSpanRef = useRef(onVoiceSpan);
  const clientToolsRef = useRef(clientTools);
  onVoiceSpanRef.current = onVoiceSpan;
  clientToolsRef.current = clientTools;
  settingsRef.current = settings;
  permissionRef.current = permission;
  modelsRef.current = models;
  botIdRef.current = botId;
  botNameRef.current = botName;
  botGoalRef.current = botGoal;
  botTypeRef.current = botType;
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
    const onHost = (event) => setSettingsRoot(event.detail || null);
    window.addEventListener('detail-settings', onHost);
    return () => window.removeEventListener('detail-settings', onHost);
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
    setPermission(parsePermission(localStorage.getItem(SPEND_PERMISSION_KEY)));
  }, []);

  useEffect(() => {
    let stop = false;
    fetch('/api/models', { cache: 'no-store' })
      .then(response => (response.ok ? response.json() : null))
      .then(data => {
        if (stop || !Array.isArray(data?.models) || data.models.length === 0) return;
        const next = promptModels(data.models);
        setModels(next);
        setChatModel(current => (next.some(item => item.key === current) ? current : next[0].key));
        if (!next.some(item => item.key === modelRef.current)) modelRef.current = next[0].key;
      })
      .catch(() => {});
    return () => { stop = true; };
  }, []);

  useEffect(() => {
    const model = models.find(item => item.key === chatModel) ?? models[0];
    onContextWindow?.(contextWindowFor(model?.key, model?.contextWindow));
  }, [models, chatModel, onContextWindow]);

  useEffect(() => {
    if (!settingsReady) return;
    localStorage.setItem(VOICE_STORAGE_KEY, JSON.stringify(settings));
  }, [settings, settingsReady]);

  const editToken = editTokenIn(lines);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const resolveRef = useRef(null);
  useEffect(() => {
    onBindAccess?.((line, accepted) => resolveRef.current?.(line, accepted));
  }, [onBindAccess]);
  const seenEdit = useRef('');
  useEffect(() => {
    if (!editToken) return undefined;
    let stop = false;
    const handle = window.setTimeout(() => {
      if (stop || seenEdit.current === editToken) return;
      seenEdit.current = editToken;
      const rows = linesRef.current;
      const index = rows.findIndex((line) => line?.editToken === editToken);
      if (index < 0) return;
      void regenerate(rows[index].text, rows.slice(0, index));
    }, 0);
    return () => {
      stop = true;
      window.clearTimeout(handle);
    };
  }, [editToken]);

  useEffect(() => {
    if (!body) return;
    localStorage.setItem(FLOAT_STORAGE_KEY, JSON.stringify(place));
  }, [place, body]);

  useEffect(() => {
    setDraft('');
    setFiles([]);
    setMention('');
    if (!callBotRef.current || callBotRef.current === botId) return;
    if (presenceRef.current === 'off' || presenceRef.current === 'leave') return;
    setWarm(false);
    setMode('mini');
  }, [botId]);

  useEffect(() => {
    if (!muted || presence === 'off' || presence === 'leave') return undefined;
    const id = window.setInterval(() => sealMic(), 200);
    return () => window.clearInterval(id);
  }, [muted, presence]);

  useEffect(() => {
    if (!hidden) return;
    if (presenceRef.current === 'off' || presenceRef.current === 'leave') return;
    setMode('mini');
  }, [hidden]);

  useEffect(() => () => {
    window.clearTimeout(leaveTimer.current);
    window.clearTimeout(thinkTimer.current);
    onThinking?.(false);
    const started = voiceStarted.current;
    if (started) {
      voiceStarted.current = 0;
      onVoiceSpanRef.current?.(performance.now() - started);
    }
    const gate = micGate.current;
    gate.setMuted(true);
    const generation = gate.generation;
    const live = sessionRef.current;
    sessionRef.current = null;
    gate.stop();
    Promise.resolve(live?.endSession?.()).finally(() => gate.disarm(generation));
  }, []);

  useEffect(() => {
    const token = mentionIn(draft);
    if (!token || typeof resolveMention !== 'function') {
      setMention('');
      setMentionCopy(null);
      return undefined;
    }
    let stop = false;
    resolveMention(token).then((recipient) => {
      if (stop) return;
      setMention(recipientHint(recipient));
      if (recipient?.address && recipient.kind === 'sns') {
        setMentionCopy({ address: recipient.address, prefix: recipient.domain });
      } else if (recipient?.address) {
        const prefix = recipient.displayName || (recipient.handle ? `@${recipient.handle}` : '');
        setMentionCopy({ address: recipient.address, prefix });
      } else {
        setMentionCopy(null);
      }
    }).catch(() => {
      if (!stop) {
        setMention('');
        setMentionCopy(null);
      }
    });
    return () => { stop = true; };
  }, [draft, resolveMention]);

  async function addFiles(list) {
    const room = Math.max(0, 10 - files.length);
    const picked = [...list].slice(0, room);
    const next = [];
    for (const file of picked) {
      const name = displayFileName(file.name) || canonicalFileName(file.name) || 'file';
      const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const sessionUrl = rememberSessionFile(id, file);
      const url = (await previewUrl(file)) || sessionUrl;
      next.push({
        id,
        name,
        size: file.size,
        type: file.type || 'file',
        url,
        blob: file,
        addedAt: Date.now(),
      });
    }
    if (next.length === 0) return;
    setFiles(current => [...current, ...next].slice(0, 10));
    onAttach?.(next);
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

  function currentEffortId() {
    const model = modelsRef.current.find(item => item.key === modelRef.current) ?? modelsRef.current[0];
    const label = typeof effortRef.current === 'string' ? effortRef.current : '';
    return model?.levels?.find(level => level.label === label)?.id
      || model?.levels?.find(level => level.default)?.id
      || '';
  }

  async function sendMessage(text) {
    const spokenText = typeof text === 'string' ? text.trim() : draft.trim();
    const attached = files.map(file => file.name).join(', ');
    const spoken = clipOwnerMessage(attached ? `${spokenText}${spokenText ? '\n' : ''}${attached}` : spokenText);
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
          ? 'Pick an agent before chatting.'
          : 'Sign in to chat with this agent.');
        return;
      }
      let accessToken = '';
      try { accessToken = (await getAccessToken?.()) || ''; } catch { accessToken = ''; }
      const result = await sendBotChat({
        ownerId,
        botId,
        message: spoken,
        history: prior,
        name: botName,
        goal: botGoal,
        type: botType,
        permission,
        model: modelRef.current,
        effort: currentEffortId(),
        shellBots,
        shellWallets,
        shellBalanceLabel,
        fileCatalog: catalogRef.current,
        accessToken,
        deskGrant: readDeskGrant(window.sessionStorage, ownerId, Date.now())?.grant || '',
      });
      await settleChat(result, spoken, prior);
    } catch {
      pushLine('agent', chatFailureNote('network'));
    } finally {
      sendingRef.current = false;
      setThinking(false);
      onThinking?.(false);
    }
  }

  async function regenerate(text, prior) {
    const spoken = clipOwnerMessage(text);
    if (!spoken || sendingRef.current) return;
    setThinking(true);
    onThinking?.(true);
    window.clearTimeout(thinkTimer.current);
    sendingRef.current = true;
    try {
      if (!ownerId || !botId) {
        pushLine('agent', ownerId
          ? 'Pick an agent before chatting.'
          : 'Sign in to chat with this agent.');
        return;
      }
      let accessToken = '';
      try { accessToken = (await getAccessToken?.()) || ''; } catch { accessToken = ''; }
      const result = await sendBotChat({
        ownerId,
        botId,
        message: spoken,
        history: prior,
        name: botName,
        goal: botGoal,
        type: botType,
        permission,
        model: modelRef.current,
        effort: currentEffortId(),
        shellBots,
        shellWallets,
        shellBalanceLabel,
        fileCatalog: catalogRef.current,
        accessToken,
        deskGrant: readDeskGrant(window.sessionStorage, ownerId, Date.now())?.grant || '',
      });
      if (!result.ok) pushLine('agent', chatFailureNote(result.error));
      else await settleChat(result, spoken, prior);
    } catch {
      pushLine('agent', chatFailureNote('network'));
    } finally {
      sendingRef.current = false;
      setThinking(false);
      onThinking?.(false);
    }
  }

  function pushLine(role, text, targetId = botIdRef.current, tokens = 0, activity = [], access = null) {
    const spoken = typeof text === 'string' ? text.trim() : '';
    if (!spoken) return;
    const line = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, role, text: spoken };
    if (Number.isSafeInteger(tokens) && tokens > 0) line.tokens = tokens;
    if (Array.isArray(activity) && activity.length > 0) line.activity = activity;
    if (access && access.kind === 'inline' && typeof access.name === 'string') line.access = access;
    onLine?.(line, targetId);
  }

  async function settleChat(result, spoken, prior, grants) {
    if (!result?.ok) {
      pushLine('agent', chatFailureNote(result?.error));
      return;
    }
    if (result.hold?.kind === 'modal') {
      if (result.reply) pushLine('agent', result.reply, botIdRef.current, result.tokens, result.activity);
      const accepted = typeof onConfirm === 'function' ? await onConfirm(result.hold.prompt || result.hold.label) : false;
      if (!accepted) {
        pushLine('note', 'That stayed unconfirmed.');
        return;
      }
      await continueChat(spoken, prior, [result.hold]);
      return;
    }
    if (result.hold?.kind === 'inline') {
      pushLine('agent', result.reply || result.hold.label, botIdRef.current, result.tokens, result.activity, result.hold);
      return;
    }
    pushLine('agent', result.reply, botIdRef.current, result.tokens, result.activity);
  }

  async function continueChat(spoken, prior, grants) {
    setThinking(true);
    onThinking?.(true);
    sendingRef.current = true;
    try {
      let accessToken = '';
      try { accessToken = (await getAccessToken?.()) || ''; } catch { accessToken = ''; }
      const result = await sendBotChat({
        ownerId,
        botId: botIdRef.current,
        message: spoken,
        history: prior,
        name: botName,
        goal: botGoal,
        type: botType,
        permission: permissionRef.current,
        grants,
        model: modelRef.current,
        effort: currentEffortId(),
        shellBots,
        shellWallets,
        shellBalanceLabel,
        fileCatalog: catalogRef.current,
        accessToken,
        deskGrant: readDeskGrant(window.sessionStorage, ownerId, Date.now())?.grant || '',
      });
      await settleChat(result, spoken, prior, grants);
    } catch {
      pushLine('agent', chatFailureNote('network'));
    } finally {
      sendingRef.current = false;
      setThinking(false);
      onThinking?.(false);
    }
  }

  resolveRef.current = async (line, accepted) => {
    if (!line?.access || sendingRef.current) return;
    onPatchLine?.(line.id, { access: null }, botIdRef.current);
    if (accepted !== true) {
      pushLine('note', 'Access stayed off.');
      return;
    }
    const thread = linesRef.current;
    const index = thread.findIndex(item => item.id === line.id);
    const before = index >= 0 ? thread.slice(0, index) : thread;
    let userIndex = -1;
    for (let i = before.length - 1; i >= 0; i -= 1) {
      if (before[i]?.role === 'user') {
        userIndex = i;
        break;
      }
    }
    if (userIndex < 0) return;
    await continueChat(before[userIndex].text, before.slice(0, userIndex), [line.access]);
  };

  function sealMic(live = sessionRef.current) {
    micGate.current.enforce();
    try {
      live?.setMicMuted?.(micGate.current.muted);
    } catch {
      /* the locked track stays silent even if the session flag fails */
    }
  }

  function finishLeave(keepNote) {
    commitVoice();
    const gate = micGate.current;
    gate.setMuted(true);
    const generation = gate.generation;
    const live = sessionRef.current;
    sessionRef.current = null;
    connectingRef.current = false;
    setMuted(false);
    setWarm(false);
    setMode('full');
    setCallName('');
    setCallBotId(null);
    callBotRef.current = null;
    if (!keepNote) setNote('');
    setPhase('off');
    try {
      live?.setMicMuted?.(true);
    } catch {
      /* the track lock covers the hang-up */
    }
    gate.stop();
    Promise.resolve(live?.endSession?.())
      .catch(() => {})
      .finally(() => {
        gate.disarm(generation);
        userEndedRef.current = false;
      });
  }

  function closeStage(keepNote = false, { userEnded = false } = {}) {
    if (userEnded) userEndedRef.current = true;
    if (presenceRef.current === 'off' || presenceRef.current === 'leave') return;
    setPhase('leave');
    setWarm(false);
    window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => finishLeave(keepNote), LEAVE_MS);
  }

  function toggleMute() {
    const next = !micGate.current.muted;
    micGate.current.setMuted(next);
    setMuted(next);
    sealMic();
  }

  function runDictation(options = {}) {
    if (presenceRef.current !== 'off' || sessionRef.current || connectingRef.current) {
      return Promise.reject(dictationBusyError());
    }
    dictationRef.current?.cancel?.();
    const job = startBrowserDictation({
      onPartial: typeof options?.onPartial === 'function' ? options.onPartial : null,
    });
    dictationRef.current = job;
    // Keep returning `job` so PromptBar can call job.cancel() — wrapping in
    // Promise.resolve(...).finally() strips the cancel method.
    void Promise.resolve(job).finally(() => {
      if (dictationRef.current === job) dictationRef.current = null;
    });
    return job;
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
    dictationRef.current?.cancel?.();
    dictationRef.current = null;
    connectingRef.current = true;
    const id = botIdRef.current;
    callBotRef.current = id;
    setCallBotId(id);
    setCallName(botName);
    setMode('full');
    setPhase('enter');
    setNote('');
    micGate.current.arm(typeof navigator === 'undefined' ? null : navigator.mediaDevices);
    micGate.current.setMuted(false);
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
      const tools = clientToolsRef.current;
      const owner = typeof ownerId === 'string' ? ownerId.trim() : '';
      let live = null;
      const sessionOptions = {
        conversationToken: payload.token,
        overrides: payload.overrides ?? voiceOverrides(payload),
        // ElevenLabs substitutes {{owner_id}} on voice webhook headers (list_bots / get_wallets).
        ...(owner ? { dynamicVariables: { owner_id: owner, spend_permission: permissionRef.current } } : {}),
        customLlmExtraBody: {
          ownerPermission: permissionRef.current,
          botName: botNameRef.current,
          botGoal: botGoalRef.current,
          botType: botTypeRef.current,
        },
        ...(tools && typeof tools === 'object' ? { clientTools: tools } : {}),
        onMessage: ({ message, role }) => {
          if (sessionRef.current !== live) return;
          pushLine(role === 'user' ? 'user' : 'agent', message, callBotRef.current);
        },
        onModeChange: ({ mode }) => {
          if (sessionRef.current === live) modeRef.current = mode;
        },
        onVadScore: ({ vadScore }) => {
          if (sessionRef.current === live) vadRef.current = vadScore;
        },
        onError: (message, context) => {
          if (sessionRef.current !== live && live != null) return;
          setNote(voiceErrorNote(message, context));
        },
        onDisconnect: (details) => {
          if (sessionRef.current !== live && live != null) return;
          const outcome = classifyVoiceDisconnect(details, { userEnded: userEndedRef.current });
          sessionRef.current = null;
          modeRef.current = 'listening';
          vadRef.current = 0;
          if (outcome.note) setNote(outcome.note);
          closeStage(Boolean(outcome.note));
        },
      };
      // Retry without TTS overrides when the portal agent rejects voiceId/speed.
      live = await startVoiceConversation(Conversation, sessionOptions);
      if (!connectingRef.current) {
        micGate.current.setMuted(true);
        micGate.current.stop();
        await live.endSession?.().catch(() => {});
        return;
      }
      sessionRef.current = live;
      live.setVolume?.({ volume: 1 });
      sealMic(live);
      voiceStarted.current = performance.now();
      // Bind conversation → Privy owner so Worker tool webhooks can resolve owner_id
      // even when ElevenLabs does not substitute {{owner_id}} in headers.
      try {
        const conversationId = typeof live.getId === 'function' ? live.getId() : '';
        if (owner && conversationId) {
          void fetch('/api/voice/bind', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversationId, ownerId: owner }),
            cache: 'no-store',
          }).catch(() => {});
        }
      } catch {
        /* tools may still work via dynamicVariables */
      }
    } catch (error) {
      micGate.current.disarm();
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
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const live = presence !== 'off';
  const stageOpen = mode === 'full' && presence === 'on';
  const floatOpen = mode === 'mini' && (presence === 'on' || presence === 'enter');

  const menuOpen = floatOpen && !dragging && warm;

  const stageNode = live && stage ? createPortal(
    <div className={`voice-stage${stageOpen ? ' is-open' : ''}`} role="dialog" aria-hidden={!stageOpen} aria-label={`Talk with ${callName || botName}`}>
      <GradientAscii color={speaker === 'agent' ? '#ff3a38' : speaker === 'user' ? '#3a7cff' : '#bdbdbd'} />
      <h2 className="voice-stage-name">{callName || botName}</h2>
      <div className="voice-orb">
        {mode === 'full' ? <TalkOrb sessionRef={sessionRef} modeRef={modeRef} vadRef={vadRef} size={0.78} onSpeaker={setSpeaker} /> : null}
      </div>
      <div className="voice-script" aria-live="polite">
        {callBotId && callBotId === botId ? (
          <ChatBubbles lines={lines} botName={callName || botName} thinking={thinking} onEdit={onEditLine} />
        ) : (
          <p className="voice-note">Talking with {callName}. Minimize to keep chatting.</p>
        )}
        {note ? <p className="voice-note">{note}</p> : null}
      </div>
      <div className="voice-rails">
        <aside className="voice-side" aria-label="Speed">
          <WakeSlider
            value={settings.speed}
            min={SPEED_MIN}
            max={SPEED_MAX}
            step={SPEED_STEP}
            bars={22}
            height={44}
            restHeight={10}
            ariaLabel="Speed"
            showValue
            formatValue={speed => `${Number(speed).toFixed(2)}×`}
            onChange={speed => setSettings(current => parseVoiceSettings({ ...current, speed }))}
          />
          <div className="voice-controls">
            <button type="button" className={`icon-btn${muted ? ' is-on' : ''}`} aria-label={muted ? 'Unmute' : 'Mute'} aria-pressed={muted} onClick={toggleMute}>
              {muted ? <MicOff size={18} strokeWidth={1.75} /> : <Mic size={18} strokeWidth={1.75} />}
            </button>
            <button type="button" className="icon-btn" aria-label="Minimize voice" onClick={() => setMode('mini')}>
              <Minimize2 size={16} strokeWidth={1.75} />
            </button>
            <button type="button" className="icon-btn is-stop" aria-label="Stop voice" onClick={() => closeStage(false, { userEnded: true })}>
              <Square size={16} strokeWidth={1.75} />
            </button>
          </div>
        </aside>
      </div>
    </div>,
    stage,
  ) : null;

  const floatNode = live && body ? createPortal(
    <div
      className={`voice-float${floatOpen ? ' is-open' : ''}${menuOpen ? ' is-menu' : ''}${dragging ? ' is-dragging' : ''}${place.x < 460 ? ' is-flip' : ''}`}
      inert={floatOpen ? undefined : true}
      style={{ left: place.x, top: place.y, width: FLOAT_SIZE }}
      onMouseEnter={() => {
        window.clearTimeout(warmTimer.current);
        if (!dragging) setWarm(true);
      }}
      onMouseLeave={() => {
        window.clearTimeout(warmTimer.current);
        warmTimer.current = window.setTimeout(() => setWarm(false), 200);
      }}
    >
      <div className="voice-float-menu">
        <div className="voice-float-grid">
          <button type="button" className={muted ? 'is-on' : ''} aria-label={muted ? 'Unmute' : 'Mute'} aria-pressed={muted} onClick={toggleMute}>
            {muted ? <MicOff size={16} strokeWidth={1.75} /> : <Mic size={16} strokeWidth={1.75} />}
          </button>
          <button type="button" aria-label="Full view" onClick={() => setMode('full')}>
            <Maximize2 size={16} strokeWidth={1.75} />
          </button>
          <button type="button" className="is-stop" aria-label="End" onClick={() => closeStage(false, { userEnded: true })}>
            <Square size={14} strokeWidth={1.75} />
          </button>
          <span className="voice-float-who" data-side={speaker}>{callName || botName}</span>
        </div>
      </div>
      <button
        type="button"
        className="voice-float-orb"
        aria-label={`Voice with ${callName || botName}. Drag to move.`}
        aria-expanded={menuOpen}
        onPointerDown={onOrbPointerDown}
      >
        {mode === 'mini' ? <TalkOrb sessionRef={sessionRef} modeRef={modeRef} vadRef={vadRef} size={0.58} onSpeaker={setSpeaker} /> : null}
        <span className="voice-float-name" data-side={speaker}>{callName || botName}</span>
      </button>
    </div>,
    body,
  ) : null;

  const settingsNode = settingsRoot ? createPortal(
    <VoicePicks settings={settings} onChange={setSettings} />,
    settingsRoot,
  ) : null;

  return (
    <div className={`talk-dock${hidden ? ' is-away' : ''}`} ref={dockRef}>
      {stageNode}
      {floatNode}
      {settingsNode}
      <ProviderAdd open={providerOpen} onClose={() => setProviderOpen(false)} />
      {note && presence === 'off' ? <p className="voice-note" role="status">{note}</p> : null}
      {mentionCopy ? (
        <p className="mention-hint" role="status"><AddressCopy address={mentionCopy.address} prefix={mentionCopy.prefix} /></p>
      ) : mention ? <p className="mention-hint" role="status">{mention}</p> : null}
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
          models={models}
          defaultModel={chatModel}
          efforts={(models.find(item => item.key === chatModel) ?? models[0])?.levels?.map(level => level.label) ?? []}
          defaultEffort={(models.find(item => item.key === chatModel) ?? models[0])?.levels?.find(level => level.default)?.label ?? ''}
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
          onDictate={live ? undefined : runDictation}
          permission={permission}
          onEffortChange={(label) => { effortRef.current = label; }}
          onAddProvider={() => setProviderOpen(true)}
          onModelChange={(key) => {
            const item = models.find(model => model.key === key);
            if (!item || item.key === modelRef.current) return;
            modelRef.current = item.key;
            setChatModel(item.key);
            const next = item.levels?.find(level => level.default)?.label || item.levels?.[0]?.label || '';
            effortRef.current = next;
            pushLine('note', `Model set to ${item.name}`);
          }}
          onPermissionChange={(next) => {
            const mode = parsePermission(next);
            if (mode === permissionRef.current) return;
            setPermission(mode);
            localStorage.setItem(SPEND_PERMISSION_KEY, mode);
            pushLine('note', `Permissions set to ${permissionById(mode).label}`);
          }}
          accessory={usage ? <ContextUsage usage={usage} /> : null}
          endSlot={(
            <button
              type="button"
              className={`voice-mode${live ? ' is-on' : ''}`}
              aria-label={live ? `Stop voice mode with ${callName || botName}` : 'Voice mode'}
              aria-pressed={live}
              title={live ? 'Stop voice mode' : 'Talk live with the agent'}
              onMouseDown={event => event.preventDefault()}
              onClick={() => { if (live) closeStage(false, { userEnded: true }); else startSession(); }}
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

const VOICE_RGB = {
  agent: [255, 58, 56],
  user: [58, 124, 255],
  idle: [231, 237, 242],
};

function voiceHex(rgb) {
  const channel = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  return `#${channel(rgb[0])}${channel(rgb[1])}${channel(rgb[2])}`;
}

function TalkOrb({ sessionRef, modeRef, vadRef, size, onSpeaker }) {
  const [talk, setTalk] = useState({ side: 'idle', level: 0, color: '#e7edf2' });
  const shown = useRef({ side: 'idle', level: 0, color: '#e7edf2' });
  const tint = useRef(VOICE_RGB.idle.slice());

  useEffect(() => {
    let frame = 0;
    let last = 0;
    let clock = performance.now();
    const tick = now => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(0.05, Math.max(0, (now - clock) / 1000));
      clock = now;
      const session = sessionRef.current;
      const mode = modeRef.current;
      const vad = Math.max(0, Math.min(1, Number(vadRef.current) || 0));
      const output = Math.max(0, Math.min(1, Number(session?.getOutputVolume?.() ?? 0)));
      const input = Math.max(0, Math.min(1, Number(session?.getInputVolume?.() ?? 0)));
      const agent = Math.max(output, mode === 'speaking' ? Math.max(output, 0.62) : 0);
      const user = Math.max(input, mode === 'listening' ? vad : 0);
      const side = agent > 0.08 && agent >= user ? 'agent' : user > 0.08 ? 'user' : 'idle';
      const level = side === 'idle' ? 0 : Math.max(agent, user);
      const target = VOICE_RGB[side];
      const blend = 1 - Math.exp(-dt / 0.16);
      const rgb = tint.current;
      rgb[0] += (target[0] - rgb[0]) * blend;
      rgb[1] += (target[1] - rgb[1]) * blend;
      rgb[2] += (target[2] - rgb[2]) * blend;
      const color = voiceHex(rgb);
      const prev = shown.current;
      const sideChanged = prev.side !== side;
      const colorChanged = prev.color !== color;
      const levelChanged = Math.abs(prev.level - level) >= 0.04;
      if (!sideChanged && !colorChanged && !levelChanged) return;
      if (!sideChanged && !colorChanged && now - last < 70) return;
      last = now;
      shown.current = { side, level, color };
      onSpeaker?.(side);
      setTalk(shown.current);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [sessionRef, modeRef, vadRef, onSpeaker]);

  const look = voiceOrbLook(talk.side);
  const px = size < 0.6 ? 72 : 200;
  const ball = (
    <span className="talk-orb">
      <Orb state={look.state} variant={look.variant} size={px} speed={orbSpeed(talk.level)} label={look.label} />
    </span>
  );
  return ball;
}

function VoicePicks({ settings, onChange }) {
  const voice = VOICES.find(item => item.id === settings.voiceId);
  return (
    <div className="side-option-rows">
      <div className="side-option-row">
        <span>Voice</span>
        <GlideSelect
          ariaLabel="Voice"
          size="sm"
          menuWidth={160}
          align="right"
          showTags={false}
          value={voice?.id ?? ''}
          options={VOICES.map(item => ({ value: item.id, label: item.name }))}
          onChange={voiceId => onChange(current => parseVoiceSettings({ ...current, voiceId }))}
        />
      </div>
      <div className="side-option-row">
        <span>Language</span>
        <GlideSelect
          ariaLabel="Language"
          size="sm"
          menuWidth={168}
          align="right"
          showTags={false}
          value={settings.language || 'auto'}
          options={LANGUAGES.map(item => ({ value: item.id, label: item.name }))}
          onChange={language => onChange(current => parseVoiceSettings({ ...current, language }))}
        />
      </div>
    </div>
  );
}

function editTokenIn(lines) {
  const rows = Array.isArray(lines) ? lines : [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const token = rows[index]?.editToken;
    if (typeof token === 'string' && token) return token;
  }
  return '';
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
  if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError' || error?.name === 'OverconstrainedError') {
    return 'No microphone was found, so the session stayed closed.';
  }
  if (error?.message === 'voice_unconfigured') return 'Voice is not configured on the server.';
  if (error?.message === 'voice_rejected') return 'The voice service refused the session. Publish the agent and turn on Voice ID and Speed overrides.';
  if (error?.message === 'voice_unreachable') return 'The voice service did not respond.';
  const detail = typeof error?.message === 'string' ? error.message.trim() : '';
  if (/override|voice_id|not allowed|not enabled/i.test(detail)) {
    return 'The voice agent rejected session overrides. Publish it and enable Voice ID and Speed, or try again.';
  }
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
  if (code === 'not_found' || code === 'bot_not_found') return 'This agent was not found for your account.';
  if (code === 'invalid_request') return 'Sign in to chat with this agent.';
  if (code === 'message_too_long') return 'That message is over 500 characters.';
  if (code === 'network') return 'Could not reach the chat API for a reply.';
  return 'I could not reply just now.';
}
