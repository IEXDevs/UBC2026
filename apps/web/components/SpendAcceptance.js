'use client';

import { useEffect, useRef, useState } from 'react';
import {
  PERMISSIONS,
  dollarsToBaseUnits,
  readAcceptanceDraft,
  readReviewThreshold,
  readStoredPermission,
  reviewCapToDollars,
  writeAcceptanceDraft,
} from '../lib/spend-permission.mjs';
import { blockCopy } from '../lib/block-copy.mjs';

const COPY = Object.freeze({
  ask: 'You approve every spend. Nothing moves until you confirm it.',
  review: 'You set a maximum. At or under that amount the spend can continue after the server check. Above it, you approve.',
  full: 'The agent can manage funds. You still slide to confirm, and a mainnet price quote never authorizes a transaction.',
});

function storedDraft(ownerId) {
  const empty = { permission: 'ask', dollars: '' };
  if (typeof sessionStorage === 'undefined') return empty;
  try {
    const draft = readAcceptanceDraft(sessionStorage, ownerId);
    if (draft.touched) return { permission: draft.permission, dollars: draft.dollars };
    const cap = readReviewThreshold(localStorage);
    return {
      permission: readStoredPermission(localStorage),
      dollars: reviewCapToDollars(cap || ''),
    };
  } catch {
    return empty;
  }
}

export default function SpendAcceptance({ ownerId = '', onContinue }) {
  const [permission, setPermission] = useState('ask');
  const [dollars, setDollars] = useState('');
  const [note, setNote] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = useRef(false);
  const cap = dollarsToBaseUnits(dollars);
  const reviewNeeded = permission === 'review';

  useEffect(() => {
    if (dirty.current) return;
    const next = storedDraft(ownerId);
    setPermission(next.permission);
    setDollars(next.dollars);
  }, [ownerId]);

  function remember(nextPermission, nextDollars) {
    dirty.current = true;
    try { writeAcceptanceDraft(sessionStorage, ownerId, { permission: nextPermission, dollars: nextDollars }); } catch { /* the field still holds it */ }
  }

  function submit(event) {
    event.preventDefault();
    if (leaving) return;
    if (!cap) {
      setNote(reviewNeeded
        ? 'Enter a Review by AI maximum above zero, in USDC.'
        : 'Enter a Review by AI maximum above zero. It is stored for when you switch modes.');
      return;
    }
    const savedNow = onContinue?.({ permission, reviewCap: cap }) === true;
    if (!savedNow) {
      setNote('That maximum did not save. Try Continue again.');
      return;
    }
    setNote('');
    setSaved(true);
    setLeaving(true);
  }

  return (
    <div className={`backdrop is-center no-copy${leaving ? ' is-leaving' : ''}`} onCopy={blockCopy} onCut={blockCopy}>
      <form className="sheet wallet-gate acceptance" onSubmit={submit} aria-labelledby="acceptance-title">
        <p className="acceptance-kicker">Welcome to onboarding</p>
        <h2 id="acceptance-title">How spends are approved</h2>
        <p className="quiet">First pick a spend mode and a Review by AI maximum. Next you will save and confirm your seed.</p>
        <div className="acceptance-tiers" role="radiogroup" aria-label="Spend approval">
          {PERMISSIONS.map(item => (
            <label
              key={item.id}
              className={permission === item.id ? 'is-on' : ''}
              style={permission === item.id ? { '--acceptance-accent': item.color } : undefined}
            >
              <input
                type="radio"
                name="permission"
                value={item.id}
                checked={permission === item.id}
                disabled={leaving}
                onChange={() => {
                  setPermission(item.id);
                  remember(item.id, dollars);
                }}
              />
              <span>{item.label}</span>
              <small>{COPY[item.id]}</small>
            </label>
          ))}
        </div>
        <label className={`field${reviewNeeded ? ' is-emphasis' : ''}`}>
          <span>Review by AI maximum (USDC)</span>
          <input
            inputMode="decimal"
            autoComplete="off"
            value={dollars}
            placeholder="25"
            disabled={leaving}
            onChange={(event) => {
              const next = event.target.value;
              setDollars(next);
              remember(permission, next);
            }}
          />
        </label>
        {note ? (
          <p className="gate-note is-error" role="alert">
            <span>{note}</span>
            <button type="button" className="gate-note-dismiss" aria-label="Dismiss" onClick={() => setNote('')}>
              ×
            </button>
          </p>
        ) : null}
        {saved ? <p className="acceptance-ok" role="status">Saved. Opening seed backup…</p> : null}
        <button type="submit" className="solid" disabled={!cap || leaving}>Continue</button>
      </form>
    </div>
  );
}
