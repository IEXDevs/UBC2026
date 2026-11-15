'use client';

import { useId, useRef, useState } from 'react';
import { contextTone, formatTokens } from '../lib/context-usage.mjs';

const OPEN_DELAY = 10;
const CLOSE_DELAY = 100;

function Ring({ percent, color }) {
  const radius = 6.5;
  const length = 2 * Math.PI * radius;
  const filled = (Math.min(100, Math.max(0, percent)) / 100) * length;
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

export default function ContextUsage({ usage }) {
  const [open, setOpen] = useState(false);
  const timer = useRef(0);
  const panelId = useId();
  const percent = Math.min(100, Math.max(0, Number(usage?.percent) || 0));
  const color = contextTone(percent);

  function show() {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), OPEN_DELAY);
  }

  function hide() {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY);
  }

  return (
    <div className="context-hover" onPointerEnter={show} onPointerLeave={hide} onFocus={show} onBlur={hide}>
      <button
        type="button"
        className="context-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${percent}% context`}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
      >
        <Ring percent={percent} color={color} />
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
            <span style={{ width: `${percent}%`, background: color }} />
          </div>
          <ul>
            <li><span>Input</span><b>{formatTokens(usage.input)}</b></li>
            <li><span>Output</span><b>{formatTokens(usage.output)}</b></li>
            <li><span>Messages sent</span><b>{usage.messages}</b></li>
            <li><span>Automatic compaction</span><b>{usage.compacted ? 'Applied' : 'On'}</b></li>
          </ul>
        </div>
      ) : null}
    </div>
  );
}
