'use client';

import { useEffect, useRef } from 'react';
import {
  RING_SWEEP,
  RING_TICKS,
  bandEnergy,
  hoverLift,
  pointerAngle,
  sweepPosition,
  tickAlpha,
  tickAngle,
  tickScale,
} from '../lib/voice-ring.mjs';

const RADIUS = 0.36;

function readBands(session, into) {
  const output = session?.getOutputByteFrequencyData?.();
  const input = session?.getInputByteFrequencyData?.();
  for (let index = 0; index < into.length; index += 1) {
    into[index] = Math.max(bandEnergy(output, index), bandEnergy(input, index));
  }
}

export default function VoiceHalo({
  sessionRef,
  level = 0,
  color = '#e7edf2',
  volume = 100,
  onVolume,
  size = 340,
  children,
}) {
  const rootRef = useRef(null);
  const hitRef = useRef(null);
  const headRef = useRef(null);
  const ticksRef = useRef([]);
  const propsRef = useRef({ sessionRef, level, volume, onVolume, size });
  propsRef.current = { sessionRef, level, volume, onVolume, size };

  useEffect(() => {
    const root = rootRef.current;
    const hit = hitRef.current;
    if (!root || !hit) return undefined;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const bands = new Float32Array(RING_TICKS);
    const energy = new Float32Array(RING_TICKS);
    const drag = {
      id: null,
      side: null,
      pointer: null,
      near: false,
    };
    const live = { target: 100, display: 100, sent: null, committed: null };
    const seen = { volume: null };
    let raf = 0;
    let last = performance.now();

    const paint = (now) => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      const props = propsRef.current;
      const session = props.sessionRef?.current;
      const metered = Boolean(session?.getOutputByteFrequencyData || session?.getInputByteFrequencyData);
      readBands(session, bands);
      const loud = Math.max(0, Math.min(1, Number(props.level) || 0));
      const propVolume = Math.max(0, Math.min(100, Number(props.volume) || 0));
      if (!drag.id && propVolume !== seen.volume) {
        seen.volume = propVolume;
        live.target = propVolume;
        live.committed = Math.round(propVolume);
      }
      const follow = 1 - Math.exp(-dt / (drag.id ? 0.045 : 0.09));
      const previous = live.display;
      live.display += (live.target - live.display) * follow;
      const speed = dt > 0 ? Math.abs(live.display - previous) / dt : 0;
      const comet = Math.max(drag.id ? 0.72 : 0, Math.min(1, speed / 140));
      const box = Math.min(root.clientWidth || props.size, root.clientHeight || props.size, props.size);
      const radius = box * RADIUS;
      const time = now / 1000;

      for (let index = 0; index < RING_TICKS; index += 1) {
        const el = ticksRef.current[index];
        if (!el) continue;
        const wave = 0.35 + 0.65 * Math.abs(Math.sin(index * 0.47 + time * (reduced ? 0 : 6.5)));
        const heard = metered ? Math.max(bands[index], loud * 0.45 * wave) : loud * wave;
        const tau = heard > energy[index] ? 0.05 : 0.16;
        energy[index] += (heard - energy[index]) * (1 - Math.exp(-dt / tau));
        const along = (index / (RING_TICKS - 1)) * 100;
        const angle = tickAngle(index);
        const hover = hoverLift(angle, drag.pointer, { near: drag.near, reach: 36 });
        const filled = along <= live.display ? 1 : 0;
        const head = Math.abs(along - live.display) <= 1.15 ? 1 : 0;
        const behind = live.display - along;
        const trail = behind > 0 && behind < 14 ? (1 - behind / 14) * comet : 0;
        const idle = reduced ? 0 : 0.035 * (0.5 + 0.5 * Math.sin(time * 1.25 + index * 0.33));
        const scale = Math.min(1.7, tickScale({ energy: energy[index], hover, filled, head, trail }) + idle);
        const alpha = tickAlpha({ energy: energy[index], hover, filled, head, trail });
        el.style.transform = `rotate(${angle}deg) translateY(${-radius}px) scaleY(${scale.toFixed(3)})`;
        el.style.opacity = alpha.toFixed(3);
      }

      if (headRef.current) {
        const angle = tickAngle(0) + (live.display / 100) * RING_SWEEP;
        headRef.current.style.transform = `rotate(${angle}deg) translateY(${-radius}px)`;
        headRef.current.style.opacity = (0.45 + comet * 0.55).toFixed(3);
      }

      const shown = String(Math.round(live.display));
      if (shown !== live.sent) {
        live.sent = shown;
        hit.setAttribute('aria-valuenow', shown);
        hit.setAttribute('aria-valuetext', `Agent volume ${shown}`);
      }
      raf = requestAnimationFrame(paint);
    };

    const local = (event) => {
      const bounds = root.getBoundingClientRect();
      return [event.clientX - (bounds.left + bounds.width / 2), event.clientY - (bounds.top + bounds.height / 2)];
    };

    const aim = (event) => {
      const [dx, dy] = local(event);
      const distance = Math.hypot(dx, dy);
      drag.pointer = pointerAngle(dx, dy);
      drag.near = distance > propsRef.current.size * 0.28 && distance < propsRef.current.size * 0.62;
      return { dx, dy, distance };
    };

    const take = (raw) => {
      live.target = Math.max(0, Math.min(100, raw));
      const stepped = Math.round(live.target);
      if (stepped === live.committed) return;
      live.committed = stepped;
      propsRef.current.onVolume?.(stepped);
    };

    const down = (event) => {
      if (event.button > 0 || drag.id != null) return;
      event.preventDefault();
      const { distance } = aim(event);
      if (distance < 12) return;
      drag.id = event.pointerId;
      root.dataset.dragging = '';
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      try { hit.setPointerCapture(event.pointerId); } catch { /* the window listeners still follow */ }
      hit.focus({ preventScroll: true });
      const pos = sweepPosition(drag.pointer);
      if (pos == null) drag.side = null;
      else {
        drag.side = pos >= 50 ? 'hi' : 'lo';
        take(pos);
      }
    };

    const move = (event) => {
      if (drag.id != null && event.pointerId !== drag.id) return;
      const { distance } = aim(event);
      if (drag.id == null || distance < 12) return;
      let pos = sweepPosition(drag.pointer);
      if (pos == null) {
        if (drag.side) pos = drag.side === 'hi' ? 100 : 0;
        else return;
      } else drag.side = pos >= 50 ? 'hi' : 'lo';
      take(pos);
    };

    const up = (event) => {
      if (drag.id == null || event.pointerId !== drag.id) return;
      drag.id = null;
      drag.side = null;
      delete root.dataset.dragging;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      try { hit.releasePointerCapture(event.pointerId); } catch { /* already released */ }
      take(Math.round(live.target));
    };

    const leave = () => {
      if (drag.id != null) return;
      drag.near = false;
      drag.pointer = null;
    };

    const key = (event) => {
      const current = Math.round(live.target);
      const step = event.shiftKey ? 10 : 2;
      let next = null;
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = current + step;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = current - step;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = 100;
      else return;
      event.preventDefault();
      take(next);
    };

    raf = requestAnimationFrame(paint);
    hit.addEventListener('pointerdown', down);
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerup', up);
    hit.addEventListener('pointercancel', up);
    hit.addEventListener('pointerleave', leave);
    hit.addEventListener('keydown', key);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      hit.removeEventListener('pointerdown', down);
      hit.removeEventListener('pointermove', move);
      hit.removeEventListener('pointerup', up);
      hit.removeEventListener('pointercancel', up);
      hit.removeEventListener('pointerleave', leave);
      hit.removeEventListener('keydown', key);
    };
  }, []);

  const radius = size * RADIUS;

  return (
    <div
      ref={rootRef}
      className="voice-halo"
      style={{ maxWidth: size, maxHeight: size, '--tick': color, '--ring': `${radius}px` }}
    >
      <div className="voice-ring" aria-hidden="true">
        {Array.from({ length: RING_TICKS }, (_, index) => (
          <span
            key={index}
            ref={(el) => {
              ticksRef.current[index] = el;
              if (!el) return;
              el.style.transform = `rotate(${tickAngle(index)}deg) translateY(${-radius}px) scaleY(0.34)`;
              el.style.opacity = '0.4';
            }}
            className="voice-tick"
          />
        ))}
        <span ref={headRef} className="voice-ring-head" />
      </div>
      <svg
        ref={hitRef}
        className="voice-ring-hit"
        viewBox="0 0 100 100"
        role="slider"
        tabIndex={0}
        aria-label="Agent volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(volume)}
        aria-valuetext={`Agent volume ${Math.round(volume)}`}
      >
        <circle cx="50" cy="50" r="36" />
      </svg>
      <div className="voice-halo-agent">{children}</div>
    </div>
  );
}
