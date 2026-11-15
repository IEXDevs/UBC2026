'use client';

import { useEffect, useRef } from 'react';

const GLYPHS = ' .:-=+*#%@';

function mix(hex, alpha) {
  const value = hex.replace('#', '');
  const n = Number.parseInt(value.length === 3 ? value.split('').map(ch => ch + ch).join('') : value, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function GradientAscii({ color = '#8d8d8d' }) {
  const ref = useRef(null);
  const colorRef = useRef(color);
  colorRef.current = color;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    const pointer = { x: 0.5, y: 0.42, on: false };
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    let start = performance.now();

    const draw = (now) => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#070707';
      ctx.fillRect(0, 0, width, height);

      const cell = 16;
      const cols = Math.ceil(width / cell);
      const rows = Math.ceil(height / cell);
      const cx = width * 0.5;
      const cy = height * 0.36;
      const radius = Math.min(width, height) * 0.28;
      const time = reduced ? 0 : (now - start) / 1000;
      ctx.font = '13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const x = col * cell + cell / 2;
          const y = row * cell + cell / 2;
          const dist = Math.hypot(x - cx, y - cy);
          const wave = Math.sin(time * 0.7 + dist * 0.02) * 6;
          const ring = Math.exp(-((dist - radius + wave) ** 2) / (radius * 0.55) ** 2);
          const outer = Math.exp(-((dist - radius * 1.55) ** 2) / (radius * 0.7) ** 2) * 0.45;
          let light = Math.max(ring, outer);
          if (pointer.on) {
            const reach = height * 0.1;
            const near = Math.hypot(x - pointer.x * width, y - pointer.y * height);
            if (near < reach) light = Math.min(1, light + (1 - near / reach) * 0.35);
          }
          if (light < 0.04) continue;
          const index = Math.min(GLYPHS.length - 1, Math.floor(light * (GLYPHS.length - 1)));
          const glyph = GLYPHS[index];
          if (glyph === ' ') continue;
          ctx.fillStyle = mix(colorRef.current, 0.18 + light * 0.82);
          ctx.fillText(glyph, x, y);
        }
      }
      if (!reduced) frame = requestAnimationFrame(draw);
    };

    const move = (event) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = (event.clientX - rect.left) / rect.width;
      pointer.y = (event.clientY - rect.top) / rect.height;
      pointer.on = true;
    };
    const leave = () => { pointer.on = false; };
    frame = requestAnimationFrame(draw);
    canvas.parentElement?.addEventListener('pointermove', move);
    canvas.parentElement?.addEventListener('pointerleave', leave);
    return () => {
      cancelAnimationFrame(frame);
      canvas.parentElement?.removeEventListener('pointermove', move);
      canvas.parentElement?.removeEventListener('pointerleave', leave);
    };
  }, []);

  return <canvas ref={ref} className="voice-ascii" aria-hidden="true" />;
}
