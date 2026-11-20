'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { colorLabel, colorsForPicker, randomShape } from '../lib/bot-look.mjs';
import { formatBaseUnits } from '../lib/money-views.mjs';
import { DEFAULT_TRANSFER_CAP, draftBot, draftTransferCap, isTransferLimit } from '../lib/roster.mjs';
import { AgentPhoto } from './AgentEdit';
import { usePresence } from './usePresence';

const STEPS = ['name', 'look', 'asset', 'limits'];
const STEP_TITLES = {
  name: 'Create new agent',
  look: 'Choose a color',
  asset: 'Choose a spending asset',
  limits: 'Set spending limits',
};
const SPEND_ASSETS = [
  { value: 'USDC', decimals: 6, unit: 'micro-USDC', unitsPerCoin: '1,000,000' },
  { value: 'SOL', decimals: 9, unit: 'lamports', unitsPerCoin: '1,000,000,000' },
];

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

function LimitField({ id, label, asset, value, onChange, autoFocus, exceedsTotal = false }) {
  const units = value.trim();
  const valid = isTransferLimit(units);
  return (
    <div className="field">
      <label htmlFor={id}>{label} ({asset.unit})</label>
      <input
        id={id}
        value={value}
        inputMode="numeric"
        autoFocus={autoFocus}
        aria-describedby={`${id}-conversion${exceedsTotal ? ' agent-limit-error' : ''}`}
        aria-invalid={exceedsTotal || (Boolean(units) && !valid)}
        onChange={event => onChange(event.target.value)}
      />
      <p id={`${id}-conversion`} className="hint create-conversion">
        {valid
          ? `= ${formatBaseUnits(units, asset.decimals)} ${asset.value}`
          : units.length > 40 ? 'Enter up to 40 digits.' : 'Enter a positive whole number.'}
      </p>
    </div>
  );
}

export default function CreateBotDialog({ open, onClose, onCreate, first = false }) {
  const { mounted, leaving } = usePresence(open);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#7c5cff');
  const [image, setImage] = useState('');
  const [shape, setShape] = useState('circle');
  const [asset, setAsset] = useState('');
  const [maxOutflow, setMaxOutflow] = useState('');
  const [maxPerTransaction, setMaxPerTransaction] = useState('');
  const [celebrate, setCelebrate] = useState(false);
  const [step, setStep] = useState('name');
  const stepTitle = useRef(null);
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
    setAsset('');
    setMaxOutflow('');
    setMaxPerTransaction('');
    setStep('name');
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open && (step === 'look' || step === 'asset')) stepTitle.current?.focus();
  }, [open, step]);

  if (!mounted) return null;
  const stepIndex = STEPS.indexOf(step);
  const selectedAsset = SPEND_ASSETS.find(option => option.value === asset);
  const cap = draftTransferCap(asset, maxOutflow.trim(), maxPerTransaction.trim());
  const perTransferTooHigh = !cap && isTransferLimit(maxOutflow.trim()) && isTransferLimit(maxPerTransaction.trim());
  const canContinue = {
    name: Boolean(name.trim()),
    look: true,
    asset: Boolean(selectedAsset),
    limits: Boolean(cap),
  }[step];

  function selectAsset(value) {
    if (asset === value) return;
    setAsset(value);
    const defaults = value === DEFAULT_TRANSFER_CAP.asset ? DEFAULT_TRANSFER_CAP : null;
    setMaxOutflow(defaults?.maxOutflow ?? '');
    setMaxPerTransaction(defaults?.maxPerTransaction ?? '');
  }

  function submit(event) {
    event.preventDefault();
    if (!open || !canContinue) return;
    if (step !== 'limits') {
      setStep(STEPS[stepIndex + 1]);
      return;
    }
    const bot = draftBot({ name, shape, color, cap });
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
        className={`sheet create-agent${celebrate ? ' is-create' : ''}`}
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
          <div>
            <p className="create-progress">Step {stepIndex + 1} of {STEPS.length}</p>
            <h2 id="create-agent-title" ref={stepTitle} tabIndex={-1}>{STEP_TITLES[step]}</h2>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>
        <div className="create-step" key={step}>
          {step === 'name' && (
            <div className="create-name">
              <label className="bot-name-label" htmlFor="agent-name">Name</label>
              <input
                id="agent-name"
                className="bot-name"
                value={name}
                maxLength={64}
                autoFocus
                onChange={event => setName(event.target.value)}
              />
            </div>
          )}
          {step === 'look' && (
            <div className="create-look">
              <div className="bot-preview">
                <AgentPhoto shape={shape} color={color} image={image} name={name} size={112} onImage={setImage} />
              </div>
              <div className="create-look-copy">
                <p className="bot-look-name">{name.trim()}</p>
                <p className="swatch-name">{colorLabel(color)}</p>
              </div>
              <div className="swatches" role="group" aria-label="Agent color">
                {colorsForPicker(color, true).map(swatch => (
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
            </div>
          )}
          {step === 'asset' && (
            <fieldset className="create-assets" aria-label="Spending asset">
              {SPEND_ASSETS.map(option => (
                <label key={option.value}>
                  <span>
                    <strong>{option.value}</strong>
                    <span>Limits in {option.unit}</span>
                  </span>
                  <input
                    type="radio"
                    name="spending-asset"
                    value={option.value}
                    checked={asset === option.value}
                    onChange={() => selectAsset(option.value)}
                  />
                </label>
              ))}
            </fieldset>
          )}
          {step === 'limits' && selectedAsset && (
            <div className="create-limits">
              <p className="hint">
                1 {selectedAsset.value} = {selectedAsset.unitsPerCoin} {selectedAsset.unit}.
                {asset === 'SOL' && ' SOL limits include network fees.'}
              </p>
              <LimitField id="agent-total-limit" label="Total limit" asset={selectedAsset}
                value={maxOutflow} onChange={setMaxOutflow} autoFocus />
              <LimitField id="agent-transfer-limit" label="Per-transfer limit" asset={selectedAsset}
                value={maxPerTransaction} onChange={setMaxPerTransaction} exceedsTotal={perTransferTooHigh} />
              {perTransferTooHigh && (
                <p id="agent-limit-error" className="hint create-limit-error" role="status">
                  The per-transfer limit must be at or below the total limit.
                </p>
              )}
            </div>
          )}
        </div>
        <div className="sheet-actions">
          <button type="button" className="ghost" onClick={step === 'name' ? onClose : () => setStep(STEPS[stepIndex - 1])}>
            {step === 'name' ? 'Cancel' : 'Back'}
          </button>
          <button type="submit" className="solid" disabled={!canContinue}>
            {step === 'limits' ? 'Create agent' : 'Continue'}
          </button>
        </div>
      </form>
    </div>
  );
}
