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
  recoveryWords,
  writeRecoveryStep,
} from '../lib/wallet-desk.mjs';
import { issueRecovery, openRecovery, readRecoveryState, sealRecovery, verifyRecovery } from '../lib/recovery-vault.mjs';
import { SEED_CONFIRM_HOLD_MS } from '../lib/confirm-hold.mjs';
import { blockCopy } from '../lib/block-copy.mjs';

const EMPTY_SLOTS = () => Array.from({ length: 12 }, () => '');

function PhraseEntry({ slots, onChange, disabled = false }) {
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
              disabled={disabled}
              autoFocus={index === 0 && !disabled}
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

export default function RecoveryCeremony({ wallets = [], handle = '', ownerId = '', getAccessToken = null, onDone }) {
  const [words, setWords] = useState(null);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [slots, setSlots] = useState(EMPTY_SLOTS);
  const [note, setNote] = useState('');
  const [step, setStep] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  // 'account' keeps one seed per account. 'local' is only for a desk with no account store.
  const [mode, setMode] = useState('account');
  const [vault, setVault] = useState(null);
  const [retry, setRetry] = useState(0);
  const verifierRef = useRef(null);
  const finishTimer = useRef(0);

  async function authToken() {
    try { return (await getAccessToken?.()) || ''; } catch { return ''; }
  }

  function routeFromAccount(state) {
    verifierRef.current = state.verifier ?? null;
    if (state.state === 'issued') {
      setVault(state.vault);
      setNote('A seed was already started for this account. Enter the password you set to bring it back. A new one is not made.');
      setStep('unlock');
    } else if (state.state === 'confirmed') {
      setNote('');
      setStep('restore');
    } else {
      setNote('');
      setStep('tell');
    }
  }

  useEffect(() => {
    let stop = false;
    setStep(null);
    (async () => {
      const state = await readRecoveryState((...args) => fetch(...args), { ownerId, token: await authToken() });
      if (stop) return;
      if (!state.ok) {
        setNote('Could not reach your account to check your seed. Check the connection and try again.');
        setStep('error');
        return;
      }
      if (state.local) {
        let raw = '';
        try {
          const key = recoveryStorageKey(ownerId);
          raw = key ? localStorage.getItem(key) || '' : '';
        } catch {
          raw = '';
        }
        const resume = recoveryResume(raw);
        setMode('local');
        setStep(resume.step === 'done' ? 'tell' : resume.step);
        setNote(resume.lost ? 'The last seed was not saved. This is a new one.' : '');
        return;
      }
      setMode('account');
      routeFromAccount(state);
    })();
    return () => { stop = true; };
  }, [ownerId, retry]);

  useEffect(() => {
    if (mode !== 'local' || !step || step === 'done' || step === 'success') return;
    try { writeRecoveryStep(localStorage, ownerId, step); } catch { /* the step stays on this screen */ }
  }, [ownerId, step, mode]);

  const mounted = useRef(true);
  const issuing = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (step !== 'save' || words || issuing.current) return;
    // One phrase per visit. The guard also stops a dev double-run from issuing two.
    issuing.current = true;
    (async () => {
      try {
        const phrase = await createRecoveryPhrase();
        if (mode === 'local') {
          if (mounted.current) setWords(phrase);
          return;
        }
        // The account keeps the encrypted phrase before it is shown, so another
        // browser gets this same phrase and never a new one.
        const sealed = await sealRecovery(phrase, password);
        const saved = await issueRecovery((...args) => fetch(...args), { ownerId, token: await authToken(), sealed });
        if (!mounted.current) return;
        if (saved.ok) {
          verifierRef.current = sealed.verifier;
          setWords(phrase);
          return;
        }
        if (saved.exists) {
          const state = await readRecoveryState((...args) => fetch(...args), { ownerId, token: await authToken() });
          if (mounted.current && state.ok) routeFromAccount(state);
          return;
        }
        setNote('Your account could not keep this seed yet. Check the connection and try again.');
        setStep('pass');
      } catch {
        if (mounted.current) {
          setNote('Could not create a seed. Check the connection and try again.');
          setStep('pass');
        }
      } finally {
        issuing.current = false;
      }
    })();
  }, [step, words, mode, password, ownerId]);

  async function unlockVault(event) {
    event.preventDefault();
    if (busy) return;
    const left = normalizePassphrase(password);
    if (!left) {
      setNote('Enter the password you set, 8 to 64 characters.');
      return;
    }
    setBusy(true);
    const opened = await openRecovery(vault, left);
    setBusy(false);
    if (!opened) {
      setNote('That password does not open this seed. A lost password cannot be recovered.');
      return;
    }
    setPassword(left);
    setWords(opened);
    setNote('');
    setStep('save');
  }

  async function restoreSeed(event) {
    event.preventDefault();
    if (busy || leaving) return;
    if (!recoveryWords(slots.join(' '))) {
      setNote('Enter all 12 words.');
      return;
    }
    setBusy(true);
    const checked = await verifyRecovery((...args) => fetch(...args), {
      ownerId,
      token: await authToken(),
      words: slots,
      verifier: verifierRef.current,
    });
    setBusy(false);
    if (checked.mismatch) {
      setNote('Those words do not match the seed for this account.');
      return;
    }
    if (!checked.ok) {
      setNote('Could not check the seed. Check the connection and try again.');
      return;
    }
    exitCeremony();
  }

  function exitCeremony() {
    setWords(null);
    setPassword('');
    setRepeat('');
    setSlots(EMPTY_SLOTS());
    setNote('');
    setStep('success');
    setLeaving(true);
    finishTimer.current = window.setTimeout(() => {
      onDone?.();
    }, SEED_CONFIRM_HOLD_MS);
  }

  useEffect(() => () => {
    window.clearTimeout(finishTimer.current);
  }, []);

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

  async function finishConfirm(event) {
    event.preventDefault();
    if (leaving || busy || step === 'success') return;
    if (!phraseMatches(slots.join(' '), words)) {
      setNote('Those words do not match. Check the file and try again.');
      return;
    }
    if (mode === 'account') {
      setBusy(true);
      const confirmed = await verifyRecovery((...args) => fetch(...args), {
        ownerId,
        token: await authToken(),
        words,
        verifier: verifierRef.current,
        confirm: true,
      });
      setBusy(false);
      if (!confirmed.ok) {
        setNote('Your account could not record the confirmed seed. Check the connection and try again.');
        return;
      }
    }
    exitCeremony();
  }

  if (!step) return null;

  return (
    <div className={`backdrop is-center no-copy${leaving ? ' is-leaving' : ''}`} onCopy={blockCopy} onCut={blockCopy}>
      <section className="sheet wallet-gate" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
        <h2 id="recovery-title">{step === 'success' ? 'Seed confirmed' : 'Save your seed'}</h2>
        {step === 'tell' ? (
          <>
            <p className="quiet">
              Your account gets one 12-word seed. Download it and keep the file. Until you confirm it, an encrypted copy that only your password opens stays with your account, so another browser shows this same seed. After you confirm, that copy is deleted.
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
            <p className="quiet">Download the seed to continue. After you confirm it, we keep no copy.</p>
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
          <form className="field" onSubmit={finishConfirm}>
            <p className="quiet">Type the 12 words</p>
            <PhraseEntry slots={slots} onChange={(next) => { setSlots(next); }} disabled={leaving} />
            <button type="submit" className="solid" disabled={leaving || busy}>Confirm seed</button>
          </form>
        ) : null}
        {step === 'unlock' ? (
          <form className="field" onSubmit={unlockVault}>
            <label>
              Password
              <input type="password" name="wallet-password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} />
            </label>
            <button type="submit" className="solid" disabled={busy}>Show my seed</button>
          </form>
        ) : null}
        {step === 'restore' ? (
          <form className="field" onSubmit={restoreSeed}>
            <p className="quiet">This account already saved its seed. Enter the 12 words from your file to open the desk on this browser.</p>
            <PhraseEntry slots={slots} onChange={(next) => { setSlots(next); }} disabled={leaving || busy} />
            <button type="submit" className="solid" disabled={leaving || busy}>Restore seed</button>
          </form>
        ) : null}
        {step === 'error' ? (
          <button type="button" className="solid" onClick={() => { setNote(''); setRetry(count => count + 1); }}>
            Try again
          </button>
        ) : null}
        {step === 'success' ? (
          <div className="recovery-success" role="status">
            <p className="acceptance-ok">Seed confirmed. You are set.</p>
            <p className="quiet">Opening your desk…</p>
          </div>
        ) : null}
        {note && step !== 'success' ? (
          <p className={`gate-note ${note.startsWith('Downloaded') ? 'is-ok' : 'is-error'}`} role={note.startsWith('Downloaded') ? 'status' : 'alert'}>
            <span>{note}</span>
            <button type="button" className="gate-note-dismiss" aria-label="Dismiss" onClick={() => setNote('')}>
              ×
            </button>
          </p>
        ) : null}
      </section>
    </div>
  );
}
