'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ModalClose from './ModalClose';
import { colorLabel, colorsForPicker, randomShape } from '../lib/bot-look.mjs';
import { draftBot, draftTransferCap } from '../lib/roster.mjs';
import { shortAddress } from '../lib/money-views.mjs';
import { dollarsToBaseUnits } from '../lib/spend-permission.mjs';
import { AgentPhoto } from './AgentEdit';
import { usePresence } from './usePresence';

const STEPS = ['name', 'look', 'wallet', 'limits'];
const STEP_TITLES = {
  name: 'Create new agent',
  look: 'Choose a color',
  wallet: 'Choose a wallet',
  limits: 'Set spending limits',
};

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

function LimitField({ id, label, value, onChange, autoFocus, disabled = false, exceedsTotal = false }) {
  const invalid = Boolean(value.trim()) && !dollarsToBaseUnits(value);
  return (
    <div className="field">
      <label htmlFor={id}>{label} (USD)</label>
      <input
        id={id}
        value={value}
        inputMode="decimal"
        placeholder="0.00"
        autoFocus={autoFocus}
        disabled={disabled}
        aria-describedby={exceedsTotal ? 'agent-limit-error' : invalid ? `${id}-error` : undefined}
        aria-invalid={exceedsTotal || invalid}
        onChange={event => onChange(event.target.value)}
      />
      {invalid && <p id={`${id}-error`} className="hint">Enter a dollar amount above zero.</p>}
    </div>
  );
}

export default function CreateBotDialog({ open, onClose, onCreate, wallets = [], first = false }) {
  const { mounted, leaving } = usePresence(open);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#7c5cff');
  const [image, setImage] = useState('');
  const [shape, setShape] = useState('circle');
  const [walletId, setWalletId] = useState('');
  const [maxOutflow, setMaxOutflow] = useState('');
  const [maxPerTransaction, setMaxPerTransaction] = useState('');
  const [celebrate, setCelebrate] = useState(false);
  const [step, setStep] = useState('name');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const draftId = useRef(null);
  const pending = useRef(false);
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
    setWalletId('');
    setMaxOutflow('');
    setMaxPerTransaction('');
    setStep('name');
    setError('');
    draftId.current = null;
    function onKey(event) {
      if (event.key === 'Escape' && !pending.current) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open && (step === 'look' || step === 'wallet')) stepTitle.current?.focus();
  }, [open, step]);

  if (!mounted || typeof document === 'undefined') return null;
  const stepIndex = STEPS.indexOf(step);
  const wallet = wallets.find(item => item.id === walletId) ?? (!walletId && wallets.length === 1 ? wallets[0] : null);
  const total = dollarsToBaseUnits(maxOutflow);
  const perTransfer = dollarsToBaseUnits(maxPerTransaction);
  const cap = draftTransferCap('USD', total, perTransfer);
  const perTransferTooHigh = Boolean(total && perTransfer && !cap);
  const canContinue = {
    name: Boolean(name.trim()),
    look: true,
    wallet: Boolean(wallet),
    limits: Boolean(wallet && cap),
  }[step];

  function close() {
    if (!pending.current) onClose();
  }

  async function submit(event) {
    event.preventDefault();
    if (!open || !canContinue || pending.current) return;
    if (step !== 'limits') {
      if (step === 'wallet') setWalletId(wallet.id);
      setStep(STEPS[stepIndex + 1]);
      return;
    }
    const bot = draftBot({ id: draftId.current, name, shape, color, cap, walletId: wallet.id });
    if (!bot) return;
    draftId.current = bot.id;
    pending.current = true;
    setSaving(true);
    setError('');
    const failed = 'Could not create the agent. Try again.';
    try {
      const result = await onCreate({ ...bot, image });
      if (!result?.ok) setError(result?.message || failed);
    } catch {
      setError(failed);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return createPortal(
    <div className={`backdrop is-center${first ? ' is-cover' : ''}${leaving ? ' is-leaving' : ''}`} onMouseDown={close}>
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
        <ModalClose label="Close create agent" onClick={close} />
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
          {step === 'wallet' && (
            <div className="create-wallets" role="radiogroup" aria-label="Agent wallet">
              {wallets.map(item => (
                <label key={item.id} className="create-wallet-option">
                  <input type="radio" name="agent-wallet" checked={wallet?.id === item.id} onChange={() => setWalletId(item.id)} />
                  <span><strong>{item.label || 'Wallet'}</strong><small>{shortAddress(item.address)}</small></span>
                </label>
              ))}
              {wallets.length === 0 && <p className="hint">No spendable wallet is ready. Add or unfreeze a wallet, then try again.</p>}
            </div>
          )}
          {step === 'limits' && (
            <div className="create-limits">
              <p className="hint">
                {wallet ? `These limits apply to ${wallet.label || 'the selected wallet'} and cover all tokens and network fees.`
                  : 'The selected wallet is unavailable. Go back and choose a wallet.'}
              </p>
              <LimitField id="agent-total-limit" label="Total limit"
                value={maxOutflow} onChange={setMaxOutflow} disabled={saving} autoFocus />
              <LimitField id="agent-transfer-limit" label="Per-transaction limit"
                value={maxPerTransaction} onChange={setMaxPerTransaction} disabled={saving} exceedsTotal={perTransferTooHigh} />
              {perTransferTooHigh && (
                <p id="agent-limit-error" className="hint create-limit-error" role="status">
                  The per-transaction limit must be at or below the total limit.
                </p>
              )}
              {error && <p className="hint create-limit-error" role="alert">{error}</p>}
            </div>
          )}
        </div>
        <div className="sheet-actions">
          <button type="button" className="ghost" disabled={saving} onClick={step === 'name' ? close : () => {
            setError('');
            setStep(STEPS[stepIndex - 1]);
          }}>
            {step === 'name' ? 'Cancel' : 'Back'}
          </button>
          <button type="submit" className="solid" disabled={!canContinue || saving}>
            {saving ? 'Creating…' : step === 'limits' ? 'Create agent' : 'Continue'}
          </button>
        </div>
      </form>
    </div>, document.body,
  );
}
