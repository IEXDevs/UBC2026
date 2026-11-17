'use client';

import { useEffect, useRef, useState } from 'react';
import AddressCopy from './AddressCopy';
import Spotlight from './bits/Spotlight';
import {
  createRecoveryPhrase,
  normalizePassphrase,
  phraseMatches,
  recoveryCard,
  recoveryResume,
  recoveryStorageKey,
  writeRecoveryStep,
} from '../lib/wallet-desk.mjs';

const EMPTY_SLOTS = () => Array.from({ length: 12 }, () => '');

function PhraseEntry({ slots, onChange }) {
  const refs = useRef([]);

  function focus(index) {
    refs.current[index]?.focus();
  }

  function writeFrom(index, raw) {
    const parts = raw.toLowerCase().split(/\s+/).filter(Boolean).map(part => part.replace(/[^a-z]/g, ''));
    if (parts.length === 0) {
      const next = slots.slice();
      next[index] = '';
      onChange(next);
      return;
    }
    const next = slots.slice();
    parts.forEach((part, offset) => {
      if (index + offset < 12) next[index + offset] = part;
    });
    onChange(next);
    if (/\s/.test(raw)) focus(Math.min(11, index + parts.length));
  }

  return (
    <ol className="phrase-grid">
      {slots.map((word, index) => (
        <li key={index}>
          <Spotlight className="phrase-cell">
            <span>{index + 1}</span>
            <input
              ref={node => { refs.current[index] = node; }}
              aria-label={`Word ${index + 1}`}
              value={word}
              spellCheck={false}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              autoFocus={index === 0}
              onChange={event => writeFrom(index, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === ' ') {
                  event.preventDefault();
                  focus(Math.min(11, index + 1));
                  return;
                }
                if (event.key === 'Backspace' && !word && index > 0) {
                  event.preventDefault();
                  focus(index - 1);
                }
              }}
            />
          </Spotlight>
        </li>
      ))}
    </ol>
  );
}

export default function RecoveryCeremony({ wallets = [], handle = '', ownerId = '', onDone }) {
  const [words, setWords] = useState(null);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [slots, setSlots] = useState(EMPTY_SLOTS);
  const [note, setNote] = useState('');
  const [step, setStep] = useState(null);

  useEffect(() => {
    let raw = '';
    try {
      const key = recoveryStorageKey(ownerId);
      raw = key ? localStorage.getItem(key) || '' : '';
    } catch {
      raw = '';
    }
    const resume = recoveryResume(raw);
    setStep(resume.step === 'done' ? 'tell' : resume.step);
    setNote(resume.lost ? 'The last seed was not saved. This is a new one.' : '');
  }, [ownerId]);

  useEffect(() => {
    if (!step || step === 'done') return;
    try { writeRecoveryStep(localStorage, ownerId, step); } catch { /* the step stays on this screen */ }
  }, [ownerId, step]);

  useEffect(() => {
    if (step !== 'save') return undefined;
    let stop = false;
    setWords(null);
    createRecoveryPhrase()
      .then(phrase => { if (!stop) setWords(phrase); })
      .catch(() => { if (!stop) setNote('Could not create a seed. Reload and try again.'); });
    return () => { stop = true; };
  }, [step]);

  function download() {
    if (!words || !password) return;
    const text = recoveryCard({
      words,
      passphrase: password,
      wallets,
      handle,
      at: new Date().toISOString(),
    });
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'maelstrom-recovery.txt';
    link.click();
    URL.revokeObjectURL(url);
    setSlots(EMPTY_SLOTS());
    setNote('Downloaded. We do not keep this seed or password.');
    setStep('confirm');
  }

  if (!step) return null;

  return (
    <div className="backdrop is-center">
      <section className="sheet wallet-gate" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
        <h2 id="recovery-title">Save your seed</h2>
        {step === 'tell' ? (
          <>
            <p className="quiet">
              A 12-word seed is created in this browser. Download it. We do not keep a copy.
              {handle ? ` @${handle} is the name people pay.` : ''}
            </p>
            <ul className="recovery-wallets">
              {wallets.map(wallet => (
                <li key={wallet.id || wallet.address}>
                  <Spotlight className="recovery-wallet">
                    <span>{wallet.label || 'Wallet'}</span>
                    <AddressCopy address={wallet.address} compact />
                  </Spotlight>
                </li>
              ))}
            </ul>
            <button type="button" className="solid" onClick={() => { setNote(''); setStep('pass'); }}>
              Continue
            </button>
          </>
        ) : null}
        {step === 'pass' ? (
          <form
            className="field"
            onSubmit={(event) => {
              event.preventDefault();
              const left = normalizePassphrase(password);
              if (!left || left !== repeat) {
                setNote('Use the same password, 8 to 64 characters.');
                return;
              }
              setPassword(left);
              setNote('');
              setStep('save');
            }}
          >
            <label>
              Password
              <input type="password" name="wallet-password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} />
            </label>
            <label>
              Repeat password
              <input type="password" name="wallet-password-repeat" autoComplete="new-password" value={repeat} onChange={event => setRepeat(event.target.value)} />
            </label>
            <button type="submit" className="solid">Continue</button>
          </form>
        ) : null}
        {step === 'save' ? (
          <>
            <p className="quiet">Download the seed to continue. We do not keep a copy.</p>
            <ol className="phrase-grid">
              {(words || []).map((word, index) => (
                <li key={`${word}-${index}`}>
                  <Spotlight className="phrase-cell">
                    <span>{index + 1}</span>
                    <b>{word}</b>
                  </Spotlight>
                </li>
              ))}
            </ol>
            <button type="button" className="solid" disabled={!words} onClick={download}>Download seed</button>
          </>
        ) : null}
        {step === 'confirm' ? (
          <form
            className="field"
            onSubmit={(event) => {
              event.preventDefault();
              if (!phraseMatches(slots.join(' '), words)) {
                setNote('Those words do not match. Check the file and try again.');
                return;
              }
              setWords(null);
              setPassword('');
              setRepeat('');
              setSlots(EMPTY_SLOTS());
              onDone?.();
            }}
          >
            <p className="quiet">Type the 12 words</p>
            <PhraseEntry slots={slots} onChange={(next) => { setSlots(next); setNote(''); }} />
            <button type="submit" className="solid">Confirm seed</button>
          </form>
        ) : null}
        {note ? <p className="quiet" role="status">{note}</p> : null}
      </section>
    </div>
  );
}
