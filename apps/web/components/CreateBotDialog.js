'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { BOT_COLORS, randomShape } from '../lib/bot-look.mjs';
import { draftBot } from '../lib/roster.mjs';
import { AgentPhoto } from './AgentEdit';
import { usePresence } from './usePresence';

const SPLASH = [
  { kind: 'circle', color: '#7c5cff', size: 280, x: -18, y: 8, rot: -10 },
  { kind: 'square', color: '#e85a9b', size: 190, x: 118, y: -18, rot: 18 },
  { kind: 'triangle', color: '#f0a202', size: 210, x: 124, y: 46, rot: 14 },
  { kind: 'circle', color: '#3dbea5', size: 180, x: -22, y: 78, rot: 0 },
  { kind: 'square', color: '#3b7ddd', size: 150, x: 112, y: 86, rot: -20 },
  { kind: 'triangle', color: '#e24b4b', size: 170, x: 18, y: -22, rot: 24 },
  { kind: 'circle', color: '#f0732b', size: 140, x: 46, y: 122, rot: 0 },
  { kind: 'square', color: '#5aaa4a', size: 160, x: -16, y: 118, rot: 16 },
  { kind: 'triangle', color: '#8b5a3c', size: 130, x: 78, y: 126, rot: -12 },
  { kind: 'circle', color: '#f5f5f5', size: 96, x: 128, y: 12, rot: 0 },
];

const CONFETTI_COLORS = ['#7c5cff', '#e85a9b', '#f0a202', '#3dbea5', '#3b7ddd', '#e24b4b', '#f0732b', '#5aaa4a', '#f5f5f5'];

const CONFETTI = Array.from({ length: 42 }, (_, i) => {
  const angle = (i / 42) * Math.PI * 2 + (i % 3) * 0.18;
  const distance = 180 + (i % 7) * 42;
  return {
    id: i,
    kind: ['rect', 'circle', 'triangle'][i % 3],
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    dx: Math.round(Math.cos(angle) * distance),
    dy: Math.round(Math.sin(angle) * distance - 36),
    spin: (i % 2 ? 1 : -1) * (160 + (i % 5) * 80),
    delay: (i % 6) * 16,
    w: 6 + (i % 4) * 2,
    h: i % 3 === 1 ? 6 + (i % 4) * 2 : 10 + (i % 3) * 3,
  };
});

export default function CreateBotDialog({ open, onClose, onCreate, first = false }) {
  const { mounted, leaving } = usePresence(open);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#7c5cff');
  const [image, setImage] = useState('');
  const [shape, setShape] = useState('circle');
  const [celebrate, setCelebrate] = useState(false);
  const [seenOpen, setSeenOpen] = useState(open);
  if (open !== seenOpen) {
    setSeenOpen(open);
    if (open) setCelebrate(first);
  }

  useEffect(() => {
    if (!open) return undefined;
    setName('');
    setColor('#7c5cff');
    setImage('');
    setShape(randomShape());
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  function submit(event) {
    event.preventDefault();
    const bot = draftBot({ name, shape, color });
    if (!bot) return;
    onCreate({ ...bot, image });
  }

  return (
    <div className={`backdrop is-center ${leaving ? 'is-leaving' : ''}`} onMouseDown={onClose}>
      <form
        className={`sheet${celebrate ? ' is-create' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-agent-title"
        onMouseDown={event => event.stopPropagation()}
        onSubmit={submit}
      >
        {celebrate ? (
          <>
            <div className="create-splash" aria-hidden="true">
              {SPLASH.map(piece => (
                <span
                  key={`${piece.kind}-${piece.x}`}
                  className={`create-shape is-${piece.kind}`}
                  style={{
                    '--x': `${piece.x}%`,
                    '--y': `${piece.y}%`,
                    '--size': `${piece.size}px`,
                    '--rot': `${piece.rot}deg`,
                    background: piece.color,
                  }}
                />
              ))}
            </div>
            <div className="create-scrim" aria-hidden="true" />
            <div className="create-confetti" aria-hidden="true">
              {CONFETTI.map(piece => (
                <i
                  key={piece.id}
                  className={`is-${piece.kind}`}
                  style={{
                    '--dx': `${piece.dx}px`,
                    '--dy': `${piece.dy}px`,
                    '--spin': `${piece.spin}deg`,
                    '--delay': `${piece.delay}ms`,
                    '--w': `${piece.w}px`,
                    '--h': `${piece.h}px`,
                    background: piece.color,
                  }}
                />
              ))}
            </div>
          </>
        ) : null}
        <div className="sheet-head">
          <h2 id="create-agent-title">Create New Agent</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>
        <div className="bot-preview">
          <AgentPhoto shape={shape} color={color} image={image} size={112} onImage={setImage} />
        </div>
        <input
          className="bot-name"
          value={name}
          placeholder="Name your Agent"
          aria-label="Name your Agent"
          maxLength={64}
          autoFocus
          onChange={event => setName(event.target.value)}
        />
        <div className="swatches" role="listbox" aria-label="Agent color">
          {BOT_COLORS.map(swatch => (
            <button
              key={swatch.id}
              type="button"
              className={swatch.value === color ? 'is-on' : ''}
              style={{ background: swatch.value }}
              aria-label={swatch.id}
              aria-pressed={swatch.value === color}
              onClick={() => setColor(swatch.value)}
            />
          ))}
        </div>
        <div className="sheet-actions">
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="solid" disabled={!name.trim()}>Create</button>
        </div>
      </form>
    </div>
  );
}
