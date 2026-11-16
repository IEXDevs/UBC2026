'use client';

import { useEffect, useState } from 'react';
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

const GONE = 'Maelstrom does not store this seed or password. If you leave before the download, it is gone.';

export default function RecoveryCeremony({ wallets = [], handle = '', ownerId = '', onDone }) {
  const [words, setWords] = useState(null);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [typed, setTyped] = useState('');
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
    setNote(resume.lost
      ? 'The seed from the last visit was not stored. If you did not download it, it is gone. This visit starts a new one.'
      : '');
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
      .catch(() => { if (!stop) setNote('This browser could not create a recovery phrase. Reload and try again.'); });
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
    setTyped('');
    setNote(GONE);
    setStep('confirm');
  }

  if (!step) return null;

  return (
    <div className="backdrop is-center">
      <section className="sheet wallet-gate" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
        <h2 id="recovery-title">Save your seed phrase</h2>
        <p className="quiet">{GONE}</p>
        {step === 'tell' ? (
          <>
            <p className="quiet">
              Your new wallet gets a 12-word seed phrase created in this browser. Write it down.
              Privy still signs, and the download is the only copy.
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
            <p className="quiet">This is the seed. The download button is the only way forward.</p>
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
              if (!phraseMatches(typed, words)) {
                setNote('Those words do not match the seed. Check the file and type them again.');
                return;
              }
              setWords(null);
              setPassword('');
              setRepeat('');
              setTyped('');
              onDone?.();
            }}
          >
            <label>
              Type the 12 words
              <textarea
                value={typed}
                rows={3}
                spellCheck={false}
                autoCapitalize="none"
                autoComplete="off"
                onChange={event => { setTyped(event.target.value); setNote(''); }}
              />
            </label>
            <button type="submit" className="solid">Confirm seed</button>
          </form>
        ) : null}
        {note ? <p className="quiet" role="status">{note}</p> : null}
      </section>
    </div>
  );
}
