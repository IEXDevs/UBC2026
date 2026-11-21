'use client';

import { useEffect, useId, useRef } from 'react';
import { contextTone, formatTokens, meterWidth } from '../lib/context-usage.mjs';

const OPEN_DELAY = 80;
const CLOSE_DELAY = 220;

const SOURCES = [
  { key: 'input', label: 'Input', color: '#2563eb' },
  { key: 'output', label: 'Output', color: '#dc2626' },
  { key: 'messages', label: 'Messages sent', color: '#16a34a' },
  { key: 'compaction', label: 'Automatic compaction', color: '#eab308' },
];

function sourceValue(usage, key) {
  if (key === 'input') return Number(usage?.input) || 0;
  if (key === 'output') return Number(usage?.output) || 0;
  if (key === 'messages') return Number(usage?.messages) || 0;
  return usage?.compacted ? 1 : 0;
}

function sourceLabel(usage, key) {
  if (key === 'compaction') return usage?.compacted ? 'Applied' : 'On';
  if (key === 'messages') return String(Number(usage?.messages) || 0);
  return formatTokens(sourceValue(usage, key));
}

function Ring({ percent, color, used }) {
  const radius = 6.5;
  const length = 2 * Math.PI * radius;
  const ratio = Math.min(100, Math.max(0, percent)) / 100;
  const filled = ratio > 0 ? ratio * length : Number(used) > 0 ? 3 : 0;
  return (
    <svg className="context-ring" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.28" strokeWidth="2" />
      <circle
        cx="9"
        cy="9"
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${length}`}
        transform="rotate(-90 9 9)"
      />
    </svg>
  );
}

export default function ContextUsage({ usage, open = false, onOpen, onClose }) {
  const timer = useRef(0);
  const panelId = useId();
  const percent = Math.min(100, Math.max(0, Number(usage?.percent) || 0));
  const color = contextTone(percent);

  function openNow() {
    window.clearTimeout(timer.current);
    onOpen?.();
  }

  function closeNow() {
    window.clearTimeout(timer.current);
    onClose?.();
  }

  function show() {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(openNow, OPEN_DELAY);
  }

  function hide() {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(closeNow, CLOSE_DELAY);
  }

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <div className="context-hover" onPointerEnter={show} onPointerLeave={hide} onFocus={show} onBlur={hide} onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="context-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${percent}% context`}
        onClick={openNow}
        onKeyDown={(event) => {
          if (event.key === 'Escape') closeNow();
        }}
      >
        <Ring percent={percent} color={color} used={usage?.used} />
      </button>
      {open ? (
        <div className="context-card" id={panelId} role="dialog" aria-label="Context">
          <div className="context-head">
            <span>Context</span>
            <span>{formatTokens(usage.used)} / {formatTokens(usage.limit)}</span>
          </div>
          <div
            className="context-progress"
            role="progressbar"
            aria-label="Context used"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
          >
            {SOURCES.filter(source => source.key === 'input' || source.key === 'output').map(source => {
              const value = sourceValue(usage, source.key);
              const share = usage?.limit ? (value / usage.limit) * 100 : 0;
              return (
                <span
                  key={source.key}
                  style={{ width: meterWidth(share, value), background: source.color }}
                />
              );
            })}
          </div>
          <ul>
            {SOURCES.map(source => (
              <li key={source.key}>
                <span>
                  <i className="context-swatch" style={{ background: source.color }} aria-hidden="true" />
                  {source.label}
                </span>
                <b>{sourceLabel(usage, source.key)}</b>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
