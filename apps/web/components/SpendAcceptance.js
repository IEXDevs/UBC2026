'use client';

import { useState } from 'react';
import { PERMISSIONS, dollarsToBaseUnits } from '../lib/spend-permission.mjs';

const COPY = Object.freeze({
  ask: 'You approve every spend. Nothing moves until you confirm it.',
  review: 'You set a maximum. At or under that amount the spend can continue after the server check. Above it, you approve.',
  full: 'The agent can manage funds. You still slide to confirm, and a mainnet price quote never authorizes a transaction.',
});

export default function SpendAcceptance({ onContinue }) {
  const [permission, setPermission] = useState('ask');
  const [dollars, setDollars] = useState('');
  const [note, setNote] = useState('');
  const cap = dollarsToBaseUnits(dollars);

  function submit(event) {
    event.preventDefault();
    if (!cap) {
      setNote('Enter a maximum above zero, in USDC.');
      return;
    }
    onContinue?.({ permission, reviewCap: cap });
  }

  return (
    <div className="backdrop is-center">
      <form className="sheet wallet-gate acceptance" onSubmit={submit} aria-labelledby="acceptance-title">
        <h2 id="acceptance-title">How spends are approved</h2>
        <p className="quiet">Three modes. The second one needs a maximum from you before you continue.</p>
        <div className="acceptance-tiers" role="radiogroup" aria-label="Spend approval">
          {PERMISSIONS.map(item => (
            <label key={item.id} className={permission === item.id ? 'is-on' : ''}>
              <input
                type="radio"
                name="permission"
                value={item.id}
                checked={permission === item.id}
                onChange={() => setPermission(item.id)}
              />
              <span>{item.label}</span>
              <small>{COPY[item.id]}</small>
            </label>
          ))}
        </div>
        <label className="field">
          <span>Review by AI maximum (USDC)</span>
          <input
            inputMode="decimal"
            autoComplete="off"
            value={dollars}
            placeholder="25"
            onChange={(event) => {
              setDollars(event.target.value);
              setNote('');
            }}
          />
        </label>
        {note ? <p className="quiet">{note}</p> : null}
        <button type="submit" className="solid" disabled={!cap}>Continue</button>
      </form>
    </div>
  );
}
