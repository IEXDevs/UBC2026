'use client';

import { useEffect, useRef } from 'react';
import { smoothLevel } from '../lib/voice-levels.mjs';

function ring(ctx, cx, cy, radius, amp, time, lobes, spin) {
  ctx.beginPath();
  const steps = 180;
  for (let i = 0; i <= steps; i += 1) {
    const a = (i / steps) * Math.PI * 2;
    const wave = Math.sin(a * lobes - time * spin) * 0.65 + Math.sin(a * (lobes + 5) + time * (spin + 2)) * 0.35;
    const r = radius * (1 + amp * wave);
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * 0.96;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

export default function SteelOrb({ inputLevel, outputLevel, size = 168 }) {
  const canvasRef = useRef(null);
  const live = useRef({ inputLevel, outputLevel });
  useEffect(() => {
    live.current = { inputLevel, outputLevel };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let input = 0;
    let output = 0;
    let last = performance.now();
    const draw = now => {
      const dt = Math.min(50, now - last);
      last = now;
      const targetIn = Math.max(0, Math.min(1, live.current.inputLevel?.() ?? 0));
      const targetOut = Math.max(0, Math.min(1, live.current.outputLevel?.() ?? 0));
      input = smoothLevel(input, targetIn, dt, 36, 160);
      output = smoothLevel(output, targetOut, dt, 50, 220);
      const motion = reduced ? 0.2 : 1;
      const t = now / 1000;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = size * dpr;
      if (canvas.width !== w) {
        canvas.width = w;
        canvas.height = w;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      const cx = size / 2;
      const cy = size / 2;
      const glow = ctx.createRadialGradient(cx, cy, size * 0.1, cx, cy, size * 0.48);
      glow.addColorStop(0, `rgba(226, 232, 238, ${0.05 + output * 0.16})`);
      glow.addColorStop(1, 'rgba(226, 232, 238, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.48, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.strokeStyle = `rgba(214, 220, 226, ${0.35 + output * 0.55})`;
      ctx.lineWidth = 1.25 + output * 4.5;
      ring(ctx, cx, cy, size * 0.4, output * 0.075 * motion, t, 6, 2.4);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(150, 160, 170, ${0.25 + output * 0.35})`;
      ring(ctx, cx, cy, size * 0.34, output * 0.04 * motion, t, 4, 1.2);
      ctx.stroke();
      ctx.restore();

      const core = ctx.createRadialGradient(cx - size * 0.06, cy - size * 0.08, size * 0.02, cx, cy, size * 0.24);
      core.addColorStop(0, '#f7f8f8');
      core.addColorStop(0.22, '#d7dee4');
      core.addColorStop(0.62, '#8d98a2');
      core.addColorStop(1, '#1b2126');
      ctx.fillStyle = core;
      ctx.beginPath();
      ring(ctx, cx, cy, size * 0.2, input * 0.16 * motion, t, 14, 9);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.save();
      ctx.translate(cx - size * 0.05, cy - size * 0.07);
      ctx.rotate(-0.5);
      ctx.scale(1, 0.62);
      const shine = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.09);
      shine.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
      shine.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = shine;
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.09, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return <canvas ref={canvasRef} className="steel-orb" width={size} height={size} aria-hidden="true" />;
}
