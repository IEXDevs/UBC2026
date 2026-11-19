'use client';

import { useEffect, useRef, useState } from 'react';
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
  const [dragging, setDragging] = useState(false);
  const [done, setDone] = useState(false);

  function paint(value) {
    offsetRef.current = value;
    setOffset(value);
  }

  useEffect(() => {
    paint(0);
    setDone(false);
    committed.current = false;
  }, [resetKey]);

  useEffect(() => {
    if (!dragging) return undefined;
    function onMove(event) {
      pointerMove(event);
    }
    function onUp() {
      pointerUp();
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging]);

  function maxTravel() {
    const track = trackRef.current;
    if (!track) return 0;
    return Math.max(0, track.clientWidth - 52);
  }

  function commit() {
    const max = maxTravel();
    paint(max);
    setDone(true);
    if (!committed.current) {
      committed.current = true;
      onCommit?.();
    }
  }

  function pointerDown(event) {
    if (disabled || done) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      x: event.clientX,
      origin: offsetRef.current,
      max: maxTravel(),
    };
    setDragging(true);
  }

  function pointerMove(event) {
    const drag = dragRef.current;
    if (!drag || disabled || done) return;
    const next = Math.min(drag.max, Math.max(0, drag.origin + event.clientX - drag.x));
    paint(next);
  }

  function pointerUp() {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDragging(false);
    const max = drag.max > 0 ? drag.max : maxTravel();
    if (max <= 0 || offsetRef.current >= max * 0.92) {
      commit();
      return;
    }
    paint(0);
  }

  function onKey(event) {
    if (disabled || done) return;
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

  return (
    <div
      ref={trackRef}
      className={`slide-commit${dragging ? ' is-dragging' : ''}${done ? ' is-done' : ''}${disabled ? ' is-disabled' : ''}`}
    >
      <span className="slide-commit-label">{done ? doneLabel : label}</span>
      <button
        type="button"
        className="slide-commit-thumb"
        style={{ transform: `translateX(${offset}px)` }}
        aria-label={label}
        disabled={disabled || done}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
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
