'use client';

import { cloneElement, isValidElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { animate, useMotionValue, useMotionValueEvent, useReducedMotion } from 'motion/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { MESSAGE_CHAR_CAP } from '../lib/context-usage.mjs';
import {
  ArrowDown01Icon,
  Attachment01Icon,
  Calendar03Icon,
  Cancel01Icon,
  ChartLineData01Icon,
  File02Icon,
  Globe02Icon,
  Mail01Icon,
  Mic01Icon,
  PlusSignIcon,
  SparklesIcon,
} from '@hugeicons/core-free-icons';
import './PromptBar.css';
import GlideSelect from './GlideSelect';
import { PERMISSIONS, dollarsToBaseUnits, permissionById } from '../lib/spend-permission.mjs';
import { shouldClosePermitMenu } from './permit-menu.mjs';
import { exclusiveBarMenu } from '../lib/bar-menu.mjs';
import { filterMentionSuggestions } from '../lib/mention-handles.mjs';

const ARROW_UP = [12, 4.5, 18.5, 11, 14.25, 11, 14.25, 19.5, 9.75, 19.5, 9.75, 11, 5.5, 11];
const SQUARE = [12, 6, 18, 6, 18, 12, 18, 18, 6, 18, 6, 12, 6, 6];
const EASE_IN_OUT = [0.77, 0, 0.175, 1];
const LINE = 22;
const EDGE = 11;

const DEFAULT_SOURCES = [
  { key: 'files', name: 'Photos & files', description: 'Upload from this device', icon: Attachment01Icon, attach: true },
  { key: 'web', name: 'Web search', description: 'Live results', icon: Globe02Icon },
  { key: 'sales', name: 'Sales data', description: 'Revenue and churn', icon: ChartLineData01Icon },
  { key: 'docs', name: 'Documents', description: 'Specs, notes, briefs', icon: File02Icon },
  { key: 'mail', name: 'Mail', description: 'Read and draft mail', icon: Mail01Icon },
  { key: 'calendar', name: 'Calendar', description: 'Events and availability', icon: Calendar03Icon },
];
const DEFAULT_COMMANDS = [
  { key: 'summarize', name: '/summarize', description: 'Digest the thread so far' },
  { key: 'compare', name: '/compare', description: 'Two options side by side' },
  { key: 'draft', name: '/draft', description: 'Write a first version' },
  { key: 'explain', name: '/explain', description: 'A plain-language walkthrough' },
  { key: 'tasks', name: '/tasks', description: 'Turn this into a to-do list' },
];
const DEFAULT_MODELS = [
  { key: 'nova-3', name: 'Nova 3', tag: 'Flagship' },
  { key: 'nova-mini', name: 'Nova Mini', tag: 'Fast' },
  { key: 'nova-2', name: 'Nova 2', tag: 'Legacy' },
];
const DEFAULT_EFFORTS = ['Low', 'Medium', 'High', 'Extra', 'Max'];

const mix = (a, b, t) => a + (b - a) * t;
const pathAt = (a, b, t) => {
  let d = '';
  for (let i = 0; i < a.length; i += 2) {
    d += `${i ? 'L' : 'M'}${mix(a[i], b[i], t).toFixed(2)} ${mix(a[i + 1], b[i + 1], t).toFixed(2)}`;
  }
  return `${d}Z`;
};

const parseToken = (draft) => {
  const m = /(^|\s)([@/])([\w-]*)$/.exec(draft);
  if (!m) return null;
  return { kind: m[2] === '@' ? 'at' : 'slash', query: m[3].toLowerCase(), start: m.index + m[1].length };
};

const SLASH_TOKEN = /(^|\s)(\/[a-z0-9-]*)/gi;

function paintSlash(text) {
  const value = typeof text === 'string' ? text : '';
  const nodes = [];
  let last = 0;
  let match;
  SLASH_TOKEN.lastIndex = 0;
  while ((match = SLASH_TOKEN.exec(value))) {
    const at = match.index + match[1].length;
    if (at > last) nodes.push(value.slice(last, at));
    nodes.push(<span key={at} className="prompt-bar__slash">{match[2]}</span>);
    last = at + match[2].length;
  }
  if (last < value.length) nodes.push(value.slice(last));
  return nodes;
}

function slashSections(rows) {
  const sections = [];
  rows.forEach((row, index) => {
    const label = row.group || 'Commands';
    const last = sections[sections.length - 1];
    const item = { row, index };
    if (!last || last.label !== label) sections.push({ label, rows: [item] });
    else last.rows.push(item);
  });
  return sections;
}

const renderIcon = (icon, size) =>
  (isValidElement(icon) ? icon : <HugeiconsIcon icon={icon} size={size} strokeWidth={1.8} />);

function SendGlyph({ busy, morphDuration, squash, tilt }) {
  const reduce = useReducedMotion();
  const svgRef = useRef(null);
  const pathRef = useRef(null);
  const dir = useRef(busy ? 1 : -1);
  const t = useMotionValue(busy ? 1 : 0);

  useEffect(() => {
    const target = busy ? 1 : 0;
    dir.current = busy ? 1 : -1;
    if (t.get() === target) return undefined;
    const controls = animate(
      t,
      target,
      reduce ? { duration: 0 } : { duration: morphDuration / 1000, ease: EASE_IN_OUT },
    );
    return () => controls.stop();
  }, [busy, morphDuration, reduce, t]);

  useMotionValueEvent(t, 'change', (v) => {
    pathRef.current?.setAttribute('d', pathAt(ARROW_UP, SQUARE, v));
    const goo = reduce ? 0 : Math.sin(v * Math.PI);
    const sx = 1 - squash * goo;
    if (svgRef.current) {
      svgRef.current.style.transform = goo ? `rotate(${dir.current * tilt * goo}deg) scale(${sx}, ${1 / sx})` : '';
    }
  });

  return (
    <svg
      ref={svgRef}
      className="prompt-bar__glyph"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    >
      <path ref={pathRef} d={pathAt(ARROW_UP, SQUARE, t.get())} />
    </svg>
  );
}

function PermitMenu({ selected, reviewCapDollars, onPermissionChange, onReviewCapChange, onClose }) {
  const [capDraft, setCapDraft] = useState(null);
  const [capInvalid, setCapInvalid] = useState(false);
  const capRef = useRef(null);
  const editRef = useRef(null);
  const editing = capDraft !== null;

  useLayoutEffect(() => {
    if (!editing) return;
    capRef.current?.focus({ preventScroll: true });
    capRef.current?.select();
  }, [editing]);

  function closeEditor() {
    setCapDraft(null);
    setCapInvalid(false);
    editRef.current?.focus();
  }

  function saveCap() {
    const next = dollarsToBaseUnits(capDraft);
    if (!next) {
      setCapInvalid(true);
      capRef.current?.focus();
      return;
    }
    onReviewCapChange?.(next);
    closeEditor();
  }

  return (
    <div
      className="permit-menu"
      role="group"
      aria-label="Permissions"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        if (editing) closeEditor();
        else onClose();
      }}
    >
      {PERMISSIONS.map(item => (
        <div key={item.id} className="permit-choice">
          <button
            type="button"
            className="permit-option"
            data-mode={item.id}
            aria-pressed={item.id === selected}
            onClick={() => {
              onPermissionChange?.(item.id);
              if (item.id !== 'review') onClose();
            }}
          >
            <span>{item.label}</span>
            {item.id === selected ? <span className="permit-check" aria-hidden="true">✓</span> : null}
          </button>
          {item.id === 'review' ? (
            <>
              {editing ? (
                <div className="permit-cap-field">
                  <input
                    ref={capRef}
                    inputMode="decimal"
                    autoComplete="off"
                    value={capDraft}
                    aria-label="Review by AI threshold in USDC"
                    aria-invalid={capInvalid || undefined}
                    onChange={(event) => {
                      setCapDraft(event.target.value);
                      setCapInvalid(false);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
                      event.preventDefault();
                      saveCap();
                    }}
                  />
                  <span aria-hidden="true">USDC</span>
                </div>
              ) : reviewCapDollars ? (
                <span className="permit-cap-value" title={`${reviewCapDollars} USDC`}>{reviewCapDollars} USDC</span>
              ) : null}
              <button
                ref={editRef}
                type="button"
                className="permit-edit"
                aria-label={`${editing ? 'Save' : 'Edit'} Review by AI threshold`}
                onClick={editing ? saveCap : () => setCapDraft(reviewCapDollars || '')}
              >
                {editing ? 'Save' : 'Edit'}
              </button>
              {capInvalid ? <p className="permit-cap-note" role="alert">Enter a positive amount with up to 6 decimal places.</p> : null}
            </>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export default function PromptBar({
  placeholder = 'Ask anything',
  sources = DEFAULT_SOURCES,
  handles = [],
  commands = DEFAULT_COMMANDS,
  models = DEFAULT_MODELS,
  defaultModel = '',
  efforts = DEFAULT_EFFORTS,
  defaultEffort = '',
  onEffortChange,
  busy = false,
  sendDisabled = false,
  onSend,
  onStop,
  draftSeed = null,
  onAttach,
  onDictate,
  onDraftChange,
  onChipClick,
  onRemoveAttachment,
  accessory = null,
  endSlot = null,
  permission = '',
  reviewCapDollars = '',
  onPermissionChange,
  onReviewCapChange,
  onModelChange,
  onAddProvider,
  chips = null,
  extraReady = false,
  label = 'Prompt',
  background = '#27272a',
  color = '#f5f5f5',
  menuBackground = '#323236',
  sparkColor = '#b39dff',
  sparkBoost = 1,
  width = 400,
  radius = 16,
  maxRows = 5,
  morphDuration = 240,
  squash = 0.12,
  tilt = 8,
  pressScale = 0.96,
  className = '',
}) {
  const reduce = useReducedMotion();
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const effortAnchor = useRef(null);
  const sparkRef = useRef(null);
  const typing = useRef({ energy: 0, strokes: 0 });
  const boost = useRef(sparkBoost);
  boost.current = sparkBoost;
  const dictation = useRef(0);
  const dictationJob = useRef(null);
  const dictateBase = useRef('');
  const latest = useRef({});
  latest.current = { onSend, onStop, onAttach, onDictate, onEffortChange, onDraftChange, onChipClick, onRemoveAttachment };

  const [draft, setDraft] = useState('');
  const seedId = useRef('');
  useEffect(() => {
    if (!draftSeed || draftSeed.id === seedId.current) return;
    seedId.current = draftSeed.id;
    const next = String(draftSeed.text || '').slice(0, MESSAGE_CHAR_CAP);
    setDraft(next);
    latest.current.onDraftChange?.(next);
    inputRef.current?.focus({ preventScroll: true });
  }, [draftSeed]);
  const [attachments, setAttachments] = useState([]);
  const [modelKey, setModelKey] = useState(defaultModel);
  useEffect(() => {
    if (!defaultModel) return;
    if (models.some(item => item.key === defaultModel)) setModelKey(defaultModel);
  }, [defaultModel, models]);
  const [bar, setBar] = useState(null);
  const [modelClose, setModelClose] = useState(0);
  const [contextClose, setContextClose] = useState(0);
  const [effortIndex, setEffortIndex] = useState(() => {
    const i = efforts.indexOf(defaultEffort);
    return i >= 0 ? i : Math.max(0, Math.floor((efforts.length - 1) / 2));
  });
  const effortKey = efforts.join('\u0000');
  useEffect(() => {
    const i = efforts.indexOf(defaultEffort);
    const next = i >= 0 ? i : Math.max(0, efforts.length - 1);
    setEffortIndex(next);
    latest.current.onEffortChange?.(efforts[next] ?? '');
  }, [effortKey, defaultEffort]);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const [listening, setListening] = useState(false);
  const [pressed, setPressed] = useState(false);
  const plusOpen = bar === 'plus';
  const effortOpen = bar === 'effort';
  const permitOpen = bar === 'permit';
  const permitRef = useRef(null);
  const permitButtonRef = useRef(null);
  const [effortLeft, setEffortLeft] = useState(0);
  const permit = permission ? permissionById(permission) : null;

  const model = models.find((m) => m.key === modelKey) ?? models[0];
  const token = dismissed || bar === 'plus' || bar === 'effort' || bar === 'permit' || bar === 'model' || bar === 'context'
    ? null
    : parseToken(draft);
  const handleMenu = token?.kind === 'at';
  const open = plusOpen ? 'at' : effortOpen ? 'effort' : handleMenu ? 'handle' : (token?.kind ?? null);
  const query = plusOpen ? '' : (token?.query ?? '');
  const list = useMemo(() => {
    if (open === 'handle') return filterMentionSuggestions(handles, query);
    if (open === 'at') return sources.filter((s) => s.name.toLowerCase().includes(query));
    if (open === 'slash') return commands.filter((c) => c.name.replace(/^\//, '').toLowerCase().startsWith(query));
    return [];
  }, [open, query, handles, sources, commands]);
  const menuOpen = open && (open !== 'handle' || list.length > 0);
  const cursor = Math.min(active, Math.max(0, list.length - 1));
  const blocked = typeof sendDisabled === 'function' ? sendDisabled(draft) : sendDisabled;
  const canSend = !blocked && (draft.trim().length > 0 || attachments.length > 0 || extraReady);
  const armed = busy || canSend;
  const level = efforts[effortIndex] ?? '';
  const maxed = efforts.length > 1 && effortIndex === efforts.length - 1;

  const focusInput = () => inputRef.current?.focus({ preventScroll: true });
  const quietOthers = useCallback((name) => {
    if (name !== 'model') setModelClose(count => count + 1);
    if (name !== 'context') setContextClose(count => count + 1);
  }, []);
  const openOnly = useCallback((name) => {
    setBar(current => exclusiveBarMenu(current, name));
    setDismissed(name !== 'token');
    quietOthers(name);
  }, [quietOthers]);
  const closeMenus = useCallback(() => {
    setBar(current => (current === 'token' ? current : null));
    quietOthers(null);
  }, [quietOthers]);

  useEffect(() => {
    if (!bar && !token) return undefined;
    const onDown = (event) => {
      if (rootRef.current?.contains(event.target)) return;
      setBar(null);
      setDismissed(true);
      quietOthers(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [bar, token, quietOthers]);

  useEffect(() => {
    if (!permitOpen) return undefined;
    const onDown = (event) => {
      if (shouldClosePermitMenu(permitOpen, event.target, permitRef.current)) setBar(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [permitOpen]);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = '0px';
    const max = LINE * maxRows;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [draft, maxRows]);

  useEffect(() => () => {
    dictation.current += 1;
    dictationJob.current?.cancel?.();
    dictationJob.current = null;
  }, []);

  useEffect(() => {
    const canvas = sparkRef.current;
    if (!maxed || reduce || !canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    let raf = 0;
    let last = performance.now();
    let w = 0;
    let h = 0;
    let resizePending = false;
    const dots = [];
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const seed = () => {
      dots.length = 0;
      const count = Math.max(12, Math.round(w / 16));
      for (let i = 0; i < count; i += 1) {
        dots.push({
          x: Math.random() * w,
          y: h * (0.28 + Math.random() * 0.44),
          r: Math.random() < 0.12 ? 1.35 : 0.45 + Math.random() * 0.55,
          vx: 6 + Math.random() * 14,
          phase: Math.random() * Math.PI * 2,
          tw: 0.6 + Math.random() * 1.4,
        });
      }
    };
    const tick = (now) => {
      if (resizePending) {
        resizePending = false;
        resize();
        seed();
      }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#fff';
      ctx.shadowColor = '#fff';
      ctx.shadowBlur = 1.5;
      for (const dot of dots) {
        dot.x += dot.vx * dt;
        if (dot.x > w + 2) dot.x = -2;
        const twinkle = 0.2 + 0.8 * (0.5 + 0.5 * Math.sin((now / 1000) * dot.tw * Math.PI * 2 + dot.phase));
        ctx.globalAlpha = twinkle;
        ctx.beginPath();
        ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    resize();
    seed();
    const ro = new ResizeObserver(() => {
      resizePending = true;
    });
    ro.observe(canvas);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      ctx.clearRect(0, 0, w, h);
    };
  }, [maxed, effortOpen, reduce]);

  const setEffort = (i) => {
    const next = Math.max(0, Math.min(efforts.length - 1, i));
    if (next === effortIndex) return;
    setEffortIndex(next);
    latest.current.onEffortChange?.(efforts[next]);
  };
  const effortFromPointer = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const k = (e.clientX - rect.left - EDGE) / Math.max(1, rect.width - 2 * EDGE);
    setEffort(Math.round(k * (efforts.length - 1)));
  };
  const onEffortKey = (e) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (step) {
      e.preventDefault();
      setEffort(effortIndex + step);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setEffort(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setEffort(efforts.length - 1);
    } else if (e.key === 'Escape') {
      setBar(null);
      focusInput();
    }
  };
  const stepAt = (i) => `calc(${EDGE}px + (100% - ${EDGE * 2}px) * ${i / Math.max(1, efforts.length - 1)})`;
  const fillAt = (i) => (i === efforts.length - 1 ? '100%' : `calc(${stepAt(i)} + 7px)`);

  const pick = (row) => {
    const head = token ? draft.slice(0, token.start) : draft;
    if (row.attach) {
      setDraft(head);
      latest.current.onDraftChange?.(head);
      Promise.resolve(latest.current.onAttach?.()).then((files) => {
        if (!files) return;
        setAttachments((a) => [...a, ...(Array.isArray(files) ? files : [files])]);
      });
    } else if (open === 'at' || open === 'handle') {
      const next = `${head}@${row.name} `;
      setDraft(next);
      latest.current.onDraftChange?.(next);
    } else {
      const next = `${head}${row.name} `;
      setDraft(next);
      latest.current.onDraftChange?.(next);
    }
    setBar(null);
    setDismissed(false);
    focusInput();
  };

  const replay = (el, flag) => {
    if (!el) return;
    el.removeAttribute(flag);
    void el.offsetWidth;
    el.setAttribute(flag, '');
    const done = (event) => {
      if (event.target !== el) return;
      if (event.animationName !== 'field-release') return;
      el.removeAttribute(flag);
      el.removeEventListener('animationend', done);
    };
    el.addEventListener('animationend', done);
    window.setTimeout(() => {
      el.removeAttribute(flag);
      el.removeEventListener('animationend', done);
    }, 700);
  };

  const send = () => {
    if (!canSend) return;
    const accepted = latest.current.onSend?.(draft.trim(), { attachments, model, effort: level });
    if (accepted === false) return;
    setDraft('');
    latest.current.onDraftChange?.('');
    setAttachments([]);
    setDismissed(false);
    closeMenus();
    focusInput();
    if (!reduce) replay(rootRef.current?.querySelector('.prompt-bar__field'), 'data-sent');
  };

  const applyDictationText = (text) => {
    const base = dictateBase.current;
    const spoken = typeof text === 'string' ? text.trim() : '';
    const next = (spoken
      ? (base.trim() ? `${base.trimEnd()} ${spoken}` : spoken)
      : base).slice(0, MESSAGE_CHAR_CAP);
    setDraft(next);
    latest.current.onDraftChange?.(next);
    return next;
  };

  const toggleListen = () => {
    if (listening) {
      // Keep the same seq so cancel's resolved transcript still applies.
      dictationJob.current?.cancel?.();
      return;
    }
    const seq = ++dictation.current;
    dictateBase.current = draft;
    setListening(true);
    const job = latest.current.onDictate?.({
      onPartial: (text) => {
        if (seq !== dictation.current) return;
        applyDictationText(text);
      },
    });
    dictationJob.current = job && typeof job === 'object' ? job : null;
    Promise.resolve(job).then(
      (text) => {
        if (seq !== dictation.current) return;
        dictationJob.current = null;
        setListening(false);
        applyDictationText(text);
        focusInput();
      },
      () => {
        if (seq === dictation.current) {
          dictationJob.current = null;
          setListening(false);
        }
      },
    );
  };

  const onKeyDown = (e) => {
    if (open && list.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((cursor + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length);
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        pick(list[cursor]);
        return;
      }
    }
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setDismissed(true);
        closeMenus();
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const down = (e) => {
    if (e.button !== 0 || !armed) return;
    setPressed(true);
  };
  const up = () => setPressed(false);

  return (
    <div
      ref={rootRef}
      className={`prompt-bar${className ? ` ${className}` : ''}`}
      data-busy={busy ? '' : undefined}
      data-max={maxed ? '' : undefined}
      style={{
        '--pb-bg': background,
        '--pb-ink': color,
        '--pb-menu': menuBackground,
        '--pb-w': `${width}px`,
        '--pb-radius': `${radius}px`,
        '--pb-spark': sparkColor,
        '--pb-press': pressScale,
      }}
    >
      {menuOpen ? (
        <div
          className="prompt-bar__menu"
          role={open === 'effort' ? 'dialog' : 'listbox'}
          aria-label={open === 'handle' ? 'Handles' : open === 'at' ? 'Sources' : open === 'slash' ? 'Commands' : open === 'model' ? 'Models' : 'Effort'}
          data-kind={open}
          style={open === 'effort' ? { left: effortLeft } : undefined}
        >
          {open === 'effort' ? (
            <>
              <div className="prompt-bar__effort-head">
                <span className="prompt-bar__effort-title">Effort</span>
                <span className="prompt-bar__effort-level">{level}</span>
              </div>
              <div className="prompt-bar__effort-ends">
                <span>Faster</span>
                <span>Smarter</span>
              </div>
              <div
                className="prompt-bar__effort-track"
                role="slider"
                tabIndex={0}
                aria-label="Effort"
                aria-valuemin={0}
                aria-valuemax={efforts.length - 1}
                aria-valuenow={effortIndex}
                aria-valuetext={level}
                data-max={maxed ? '' : undefined}
                style={{ '--pb-effort-x': stepAt(effortIndex), '--pb-effort-fill': fillAt(effortIndex) }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  try {
                    e.currentTarget.setPointerCapture(e.pointerId);
                  } catch {
                    /* pointer capture is optional */
                  }
                  e.currentTarget.focus({ preventScroll: true });
                  effortFromPointer(e);
                }}
                onPointerMove={(e) => {
                  if (e.buttons & 1) effortFromPointer(e);
                }}
                onKeyDown={onEffortKey}
              >
                <span className="prompt-bar__effort-fill">
                  {maxed ? <canvas ref={sparkRef} className="prompt-bar__sparks" aria-hidden="true" /> : null}
                </span>
                {efforts.map((label, i) => (
                  <i key={label} className="prompt-bar__effort-dot" style={{ left: stepAt(i) }} />
                ))}
                <span className="prompt-bar__effort-thumb" />
              </div>
            </>
          ) : open === 'slash' ? (
            <>
              {slashSections(list).map(section => (
                <div key={section.label} className="prompt-bar__group" role="group" aria-label={section.label}>
                  <div className="prompt-bar__group-label">{section.label}</div>
                  {section.rows.map(({ row, index }) => (
                    <button
                      key={row.key}
                      type="button"
                      role="option"
                      aria-selected={index === cursor}
                      className="prompt-bar__row"
                      onMouseDown={(e) => e.preventDefault()}
                      onPointerEnter={() => setActive(index)}
                      onClick={() => pick(row)}
                    >
                      <span className="prompt-bar__row-name">{row.name}</span>
                      {row.description ? <span className="prompt-bar__row-desc">{row.description}</span> : null}
                    </button>
                  ))}
                </div>
              ))}
              {list.length === 0 ? <div className="prompt-bar__empty">No matches for “{query}”</div> : null}
            </>
          ) : (
            <>
              {list.map((row, i) => (
                <button
                  key={row.key}
                  type="button"
                  role="option"
                  aria-selected={i === cursor}
                  className="prompt-bar__row"
                  onMouseDown={(e) => e.preventDefault()}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => pick(row)}
                >
                  {open === 'at' ? <span className="prompt-bar__row-icon">{renderIcon(row.icon, 16)}</span> : null}
                  <span className="prompt-bar__row-name">{open === 'handle' ? `@${row.name}` : row.name}</span>
                  {row.description ? <span className="prompt-bar__row-desc">{row.description}</span> : null}
                </button>
              ))}
              {list.length === 0 ? <div className="prompt-bar__empty">No matches for “{query}”</div> : null}
            </>
          )}
        </div>
      ) : null}

      <div
        className="prompt-bar__field"
        role="presentation"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget || e.target === inputRef.current) closeMenus();
        }}
        onClick={focusInput}
      >
        {chips}
        {!chips && attachments.length > 0 ? (
          <div className="prompt-bar__chips">
            {attachments.map((file, i) => (
              <span key={`${file}-${i}`} className="prompt-bar__chip">
                <HugeiconsIcon icon={File02Icon} size={16} strokeWidth={2} />
                <button type="button" className="prompt-bar__chip-name" onClick={() => latest.current.onChipClick?.(file, i)}>
                  {file}
                </button>
                <button
                  type="button"
                  className="prompt-bar__chip-x"
                  aria-label={`Remove ${file}`}
                  onClick={() => {
                    setAttachments((a) => a.filter((_, j) => j !== i));
                    latest.current.onRemoveAttachment?.(i);
                  }}
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2.5} />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <div className="prompt-bar__entry">
        {draft ? <div className="prompt-bar__mirror" aria-hidden="true">{paintSlash(draft)}</div> : null}
        <textarea
          ref={inputRef}
          className="prompt-bar__input"
          rows={1}
          maxLength={MESSAGE_CHAR_CAP}
          value={draft}
          data-paint={draft ? '' : undefined}
          placeholder={listening ? 'Listening…' : placeholder}
          aria-label={label}
          onScroll={(event) => {
            const mirror = event.currentTarget.previousElementSibling;
            if (mirror?.classList?.contains('prompt-bar__mirror')) mirror.scrollTop = event.currentTarget.scrollTop;
          }}
          onChange={(e) => {
            setDraft(e.target.value.slice(0, MESSAGE_CHAR_CAP));
            latest.current.onDraftChange?.(e.target.value);
            typing.current.energy = Math.min(1.6, typing.current.energy + 0.22);
            typing.current.strokes = Math.min(4, typing.current.strokes + 1);
            openOnly('token');
            setActive(0);
          }}
          onFocus={closeMenus}
          onKeyDown={onKeyDown}
        />
        </div>

        <div className="prompt-bar__bar">
          <button
            type="button"
            className="prompt-bar__tool"
            aria-label="Add files"
            aria-expanded={sources.every((source) => source.attach) ? undefined : plusOpen}
            data-on={plusOpen ? '' : undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (sources.length > 0 && sources.every((source) => source.attach)) {
                latest.current.onAttach?.();
                return;
              }
              setActive(0);
              openOnly('plus');
              focusInput();
            }}
          >
            <HugeiconsIcon icon={PlusSignIcon} size={16} strokeWidth={2} />
          </button>
          {models.length > 0 ? (
            <span className="prompt-bar__glide" onMouseDown={(event) => event.preventDefault()} onClick={(event) => event.stopPropagation()}>
              <GlideSelect
                options={models.map((item) => ({ value: item.key, label: item.name, tag: item.tag }))}
                value={model?.key ?? ''}
                closeSignal={modelClose}
                onOpenChange={(isOpen) => {
                  if (isOpen) openOnly('model');
                  else setBar(current => (current === 'model' ? null : current));
                }}
                onChange={(key) => {
                  setModelKey(key);
                  onModelChange?.(key);
                }}
                showTags={false}
                size="sm"
                menuWidth={210}
                placement="top"
                align="left"
                ariaLabel="Choose model"
                textColor={color}
                surfaceColor="var(--pb-control-bg)"
                highlightColor="var(--pb-control-highlight)"
                menuAction={onAddProvider ? { label: 'Add Provider', onSelect: onAddProvider } : null}
              />
            </span>
          ) : onAddProvider ? <button type="button" className="prompt-bar__pick" onClick={onAddProvider}>No models shown</button> : null}
          {efforts.length > 0 ? (
            <button
              ref={effortAnchor}
              type="button"
              className="prompt-bar__pick"
              aria-label="Choose effort"
              aria-expanded={effortOpen}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const root = rootRef.current;
                const button = effortAnchor.current;
                if (root && button) {
                  const bar = root.getBoundingClientRect();
                  const btn = button.getBoundingClientRect();
                  const width = 248;
                  const left = btn.left - bar.left + btn.width / 2 - width / 2;
                  setEffortLeft(Math.max(8, Math.min(left, bar.width - width - 8)));
                }
                openOnly('effort');
                focusInput();
              }}
            >
              <HugeiconsIcon icon={SparklesIcon} size={16} strokeWidth={2} />
              <span>{level}</span>
            </button>
          ) : null}
          {permit ? (
            <div ref={permitRef} className="permit" onClick={(event) => event.stopPropagation()}>
              <button
                ref={permitButtonRef}
                type="button"
                className="prompt-bar__pick"
                aria-label={`Permissions, ${permit.label}`}
                aria-expanded={permitOpen}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => openOnly('permit')}
              >
                <span>{permit.label}</span>
                <HugeiconsIcon className="permit-chevron" icon={ArrowDown01Icon} size={11} strokeWidth={2} aria-hidden="true" />
              </button>
              {permitOpen ? (
                <PermitMenu
                  selected={permit.id}
                  reviewCapDollars={reviewCapDollars}
                  onPermissionChange={onPermissionChange}
                  onReviewCapChange={onReviewCapChange}
                  onClose={() => {
                    setBar(null);
                    permitButtonRef.current?.focus({ preventScroll: true });
                  }}
                />
              ) : null}
            </div>
          ) : null}
          {isValidElement(accessory) ? cloneElement(accessory, {
            closeSignal: contextClose,
            onOpen: () => openOnly('context'),
            onClose: () => setBar(current => (current === 'context' ? null : current)),
          }) : accessory}
          <span className="prompt-bar__spacer" />
          {onDictate ? (
            <button
              type="button"
              className="prompt-bar__tool"
              aria-label={listening ? 'Stop dictation' : 'Dictate'}
              aria-pressed={listening}
              data-on={listening ? '' : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={toggleListen}
            >
              {listening ? (
                <span className="prompt-bar__eq" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              ) : (
                <HugeiconsIcon icon={Mic01Icon} size={16} strokeWidth={2} />
              )}
            </button>
          ) : null}
          {endSlot}
          <button
            type="button"
            className="prompt-bar__send"
            disabled={!armed}
            aria-label={busy && canSend ? 'Queue message' : busy ? 'Stop' : 'Send'}
            data-armed={armed ? '' : undefined}
            data-pressed={pressed ? '' : undefined}
            onMouseDown={(e) => e.preventDefault()}
            onPointerDown={down}
            onPointerUp={up}
            onPointerCancel={up}
            onPointerLeave={up}
            onClick={() => {
              if (busy && !canSend) latest.current.onStop?.();
              else send();
            }}
          >
            <SendGlyph busy={busy && !canSend} morphDuration={morphDuration} squash={squash} tilt={tilt} />
          </button>
        </div>
      </div>
    </div>
  );
}
