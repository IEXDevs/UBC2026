'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { colorLabel, colorsForPicker, randomShape } from '../lib/bot-look.mjs';
import { draftBot } from '../lib/roster.mjs';
import { AgentPhoto } from './AgentEdit';
import { usePresence } from './usePresence';

const SPLASH = [
  { kind: 'circle', color: '#7c5cff', size: 196, side: 'left', y: '16%', gap: 28, rot: -8 },
  { kind: 'triangle', color: '#e24b4b', size: 148, side: 'left', y: '36%', gap: 78, rot: 16 },
  { kind: 'circle', color: '#3dbea5', size: 164, side: 'left', y: '56%', gap: 22, rot: 0 },
  { kind: 'square', color: '#5aaa4a', size: 136, side: 'left', y: '76%', gap: 70, rot: 12 },
  { kind: 'circle', color: '#f0732b', size: 112, side: 'left', y: '90%', gap: 36, rot: 0 },
  { kind: 'square', color: '#e85a9b', size: 168, side: 'right', y: '14%', gap: 34, rot: 14 },
  { kind: 'circle', color: '#f5f5f5', size: 92, side: 'right', y: '34%', gap: 86, rot: 0 },
  { kind: 'triangle', color: '#f0a202', size: 180, side: 'right', y: '52%', gap: 20, rot: 10 },
  { kind: 'square', color: '#3b7ddd', size: 132, side: 'right', y: '72%', gap: 64, rot: -14 },
  { kind: 'triangle', color: '#8b5a3c', size: 120, side: 'right', y: '88%', gap: 30, rot: -8 },
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
  const [step, setStep] = useState('name');
  const [moreColors, setMoreColors] = useState(false);
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
    setStep('name');
    setMoreColors(false);
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  function submit(event) {
    event.preventDefault();
    if (step === 'name') {
      if (name.trim()) setStep('look');
      return;
    }
    const bot = draftBot({ name, shape, color });
    if (!bot) return;
    onCreate({ ...bot, image });
  }

  return (
    <div className={`backdrop is-center${first ? ' is-cover' : ''}${leaving ? ' is-leaving' : ''}`} onMouseDown={onClose}>
      {celebrate ? (
        <div className="create-splash" aria-hidden="true">
          {SPLASH.map(piece => (
            <span
              key={`${piece.side}-${piece.kind}-${piece.y}`}
              className={`create-shape is-${piece.kind} is-${piece.side}`}
              style={{
                '--y': piece.y,
                '--size': `${piece.size}px`,
                '--gap': `${piece.gap}px`,
                '--rot': `${piece.rot}deg`,
                background: piece.color,
              }}
            />
          ))}
        </div>
      ) : null}
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
          <h2 id="create-agent-title">{step === 'name' ? 'Create new agent' : 'Choose a color'}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>
        {step === 'name' ? (
          <>
            <label className="bot-name-label" htmlFor="agent-name">Name</label>
            <input
              id="agent-name"
              className="bot-name"
              value={name}
              maxLength={64}
              autoFocus
              onChange={event => setName(event.target.value)}
            />
            <div className="sheet-actions">
              <button type="button" className="ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="solid" disabled={!name.trim()}>Continue</button>
            </div>
          </>
        ) : (
          <>
            <div className="bot-preview">
              <AgentPhoto shape={shape} color={color} image={image} name={name} size={112} onImage={setImage} />
            </div>
            <p className="bot-look-name">{name.trim()}</p>
            <p className="swatch-name">{colorLabel(color)}</p>
            <div className="swatches" role="listbox" aria-label="Agent color">
              {colorsForPicker(color, moreColors).map(swatch => (
                <button
                  key={swatch.id}
                  type="button"
                  className={swatch.value === color ? 'is-on' : ''}
                  style={{ background: swatch.value }}
                  aria-label={colorLabel(swatch.value)}
                  aria-pressed={swatch.value === color}
                  onClick={() => setColor(swatch.value)}
                />
              ))}
            </div>
            {moreColors ? null : (
              <button type="button" className="ghost" onClick={() => setMoreColors(true)}>More colors</button>
            )}
            <div className="sheet-actions">
              <button type="button" className="ghost" onClick={() => setStep('name')}>Back</button>
              <button type="submit" className="solid" disabled={!name.trim()}>Create</button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
