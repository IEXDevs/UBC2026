'use client';

import { useEffect, useRef, useState } from 'react';
import { slideConfirmed, slideOffset, slideReady } from './slide-gesture.mjs';
import './SlideCommit.css';

export default function SlideCommit({
  label = 'Slide to send',
  doneLabel = 'Sent',
  disabled = false,
  onCommit,
  resetKey = '',
}) {
  const trackRef = useRef(null);
  const offsetRef = useRef(0);
  const dragRef = useRef(null);
  const committed = useRef(false);
  const [offset, setOffset] = useState(0);
  const [dragMax, setDragMax] = useState(0);
  const [done, setDone] = useState(false);

  function paint(value) {
    offsetRef.current = value;
    setOffset(value);
  }

  useEffect(() => {
    dragRef.current = null;
    setDragMax(0);
    paint(0);
    setDone(false);
    committed.current = false;
  }, [resetKey]);

  useEffect(() => {
    if (!disabled || !dragRef.current) return;
    dragRef.current = null;
    setDragMax(0);
    paint(0);
  }, [disabled]);

  function maxTravel() {
    const track = trackRef.current;
    if (!track) return 0;
    return Math.max(0, track.clientWidth - 52);
  }

  function commit() {
    if (committed.current) return;
    committed.current = true;
    paint(maxTravel());
    setDone(true);
    onCommit?.();
  }

  function pointerDown(event) {
    if (disabled || committed.current || dragRef.current || !event.isPrimary || event.button !== 0) return;
    const track = trackRef.current;
    const max = maxTravel();
    if (!track || max <= 0) return;
    const scale = track.getBoundingClientRect().width / track.clientWidth;
    if (scale <= 0) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      return;
    }
    dragRef.current = {
      id: event.pointerId,
      x: event.clientX,
      origin: offsetRef.current,
      max,
      scale,
      resetKey,
    };
    setDragMax(max);
  }

  function pointerMove(event) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.id || disabled || drag.resetKey !== resetKey) return;
    paint(slideOffset(drag, event.clientX));
  }

  function pointerEnd(event) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.id) return;
    dragRef.current = null;
    setDragMax(0);
    if (!disabled && drag.resetKey === resetKey && slideConfirmed(drag, event)) {
      commit();
      return;
    }
    paint(0);
  }

  function onKey(event) {
    if (disabled || committed.current || dragRef.current) return;
    const max = maxTravel();
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      paint(Math.min(max, offsetRef.current + max / 5));
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      paint(Math.max(0, offsetRef.current - max / 5));
    } else if (event.key === 'End' || event.key === 'Enter') {
      event.preventDefault();
      commit();
    }
  }

  const dragging = dragMax > 0;
  const ready = slideReady(offset, dragMax);

  return (
    <div
      ref={trackRef}
      className={`slide-commit${dragging ? ' is-dragging' : ''}${done ? ' is-done' : ''}${disabled ? ' is-disabled' : ''}`}
    >
      <span className="slide-commit-label">{done ? doneLabel : ready ? 'Release to confirm' : label}</span>
      <button
        type="button"
        className="slide-commit-thumb"
        style={{ transform: `translateX(${offset}px)` }}
        aria-label={label}
        disabled={disabled || done}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerEnd}
        onPointerCancel={pointerEnd}
        onLostPointerCapture={pointerEnd}
        onKeyDown={onKey}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path d="M4 4.5 9 9l-5 4.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9 4.5 14 9l-5 4.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
