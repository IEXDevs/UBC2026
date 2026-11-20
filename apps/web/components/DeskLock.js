'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import SecretDraft from './SecretDraft';
import PasswordFeedback from './PasswordFeedback';
import { passwordFeedback } from '../lib/password-feedback.mjs';
import {
  createDeskLock,
  passwordProblem,
  readDeskLock,
  writeDeskGrant,
  writeDeskLock,
} from '../lib/desk-lock.mjs';
import { acceptEnteredPassword, openDeskGrant, readDeskLockState, registerDeskVerifier } from '../lib/desk-grant-client.mjs';
import { secretAcceptAllowed } from '../lib/secret-generate.mjs';
import { blockCopy } from '../lib/block-copy.mjs';
import { PhraseEntry } from './RecoveryCeremony';
import { phraseProof, readRecoveryState, verifyRecovery } from '../lib/recovery-vault.mjs';

function controlValue(form, name) {
  const node = form?.elements?.namedItem?.(name);
  return node && typeof node.value === 'string' ? node.value : '';
}

export default function DeskLock({ ownerId, onUnlock, onClose, getAccessToken }) {
  const [record, setRecord] = useState(undefined);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [copied, setCopied] = useState(false);
  const [serverLocked, setServerLocked] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [phraseGate, setPhraseGate] = useState(false);
  const [slots, setSlots] = useState(() => Array.from({ length: 12 }, () => ''));
  const [seedProof, setSeedProof] = useState('');
  const active = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, [ownerId]);
  const dismiss = useCallback(() => {
    active.current = false;
    onClose?.();
  }, [onClose]);

  useEffect(() => {
    let stopped = false;
    try {
      setRecord(readDeskLock(window.localStorage, ownerId));
    } catch {
      setRecord(null);
    }
    setPassword('');
    setConfirm('');
    setNote('');
    setGenerated(false);
    setCopied(false);
    setServerLocked(false);
    setReplacing(false);
    setPhraseGate(false);
    setSlots(Array.from({ length: 12 }, () => ''));
    setSeedProof('');
    (async () => {
      const token = typeof getAccessToken === 'function' ? await getAccessToken() : '';
      const state = await readDeskLockState(fetch, { ownerId, token }).catch(() => ({ locked: false }));
      if (!stopped && state.locked) setServerLocked(true);
    })();
    return () => { stopped = true; };
  }, [ownerId, getAccessToken]);

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') dismiss();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismiss]);

  const setting = replacing || (record == null && !serverLocked);
  const feedback = passwordFeedback(password, confirm, passwordProblem(password));

  async function checkSeed() {
    const words = slots.map(word => word.trim().toLowerCase()).filter(Boolean);
    if (words.length !== 12) {
      setNote('Type all 12 words.');
      return;
    }
    setPending(true);
    setNote('');
    try {
      const token = typeof getAccessToken === 'function' ? await getAccessToken() : '';
      const state = await readRecoveryState(fetch, { ownerId, token });
      if (!state.ok || !state.verifier) {
        setNote('This account has no seed to check. A lost password cannot be reset.');
        setPending(false);
        return;
      }
      const checked = await verifyRecovery(fetch, { ownerId, token, words, verifier: state.verifier });
      if (!checked.ok) {
        setNote(checked.mismatch
          ? 'Those words do not match the seed for this account.'
          : 'Could not check the seed. Check the connection and try again.');
        setPending(false);
        return;
      }
      const proof = await phraseProof(words, state.verifier);
      setSeedProof(proof);
      setReplacing(true);
      setPassword('');
      setConfirm('');
      setGenerated(false);
      setCopied(false);
      setPending(false);
    } catch {
      setNote('Could not check the seed. Check the connection and try again.');
      setPending(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (pending || record === undefined) return;
    if (phraseGate && !replacing) {
      await checkSeed();
      return;
    }
    const typed = controlValue(event.currentTarget, setting ? 'desk-password' : 'maelstrom-desk-unlock');
    const typedConfirm = controlValue(event.currentTarget, 'desk-password-confirm');
    const nextPassword = typed || password;
    const nextConfirm = typedConfirm || confirm;
    setNote('');
    if (setting) {
      const problem = passwordProblem(nextPassword);
      if (problem) {
        setNote(problem);
        return;
      }
      if (nextPassword !== nextConfirm) {
        setNote('Those passwords do not match.');
        return;
      }
      if (!secretAcceptAllowed({ generated, copied })) {
        setNote('Copy the generated password before you continue.');
        return;
      }
    }
    setPending(true);
    try {
      const token = typeof getAccessToken === 'function' ? await getAccessToken() : '';
      if (!active.current) return;
      if (setting) {
        const created = await createDeskLock(nextPassword);
        if (!active.current) return;
        if (replacing && !seedProof) {
          setNote('Enter the 12-word seed for this account before setting a new password.');
          setPending(false);
          return;
        }
        const registered = await registerDeskVerifier(fetch, {
          ownerId,
          token,
          verifier: created,
          replace: replacing,
          proof: replacing ? seedProof : '',
        });
        if (!active.current) return;
        if (registered.exists) {
          setServerLocked(true);
          setNote('This account already has a desk password. Enter that password.');
          setPending(false);
          return;
        }
        if (!registered.ok || !writeDeskLock(window.localStorage, ownerId, created)) {
          setNote('The password could not be saved for spends.');
          setPending(false);
          return;
        }
        const opened = await openDeskGrant(fetch, { ownerId, token, password: nextPassword });
        if (!active.current) return;
        if (!opened.ok || !writeDeskGrant(window.sessionStorage, ownerId, opened.grant, opened.until)) {
          setRecord(created);
          setReplacing(true);
          setNote('Password saved. Spends are not open yet.');
          setPending(false);
          return;
        }
        setRecord(created);
        setReplacing(false);
      } else {
        const accepted = await acceptEnteredPassword({
          fetchImpl: fetch,
          ownerId,
          token,
          password: nextPassword,
          record,
          localStorage: window.localStorage,
          sessionStorage: window.sessionStorage,
          shouldAccept: () => active.current,
        });
        if (!active.current) return;
        if (!accepted.ok) {
          setNote(accepted.error === 'wrong_password'
            ? 'Wrong password.'
            : 'The password was not accepted for spends.');
          setPending(false);
          return;
        }
      }
      setPassword('');
      setConfirm('');
      setPending(false);
      onUnlock?.();
    } catch {
      setNote('The password could not be saved on this browser.');
      setPending(false);
    }
  }

  return (
    <div className="backdrop is-center desk-lock no-copy" onMouseDown={dismiss} onCopy={blockCopy} onCut={blockCopy}>
      <section
        className="sheet wallet-gate"
        role="dialog"
        aria-modal="true"
        aria-labelledby="desk-lock-title"
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="sheet-head">
          <h2 id="desk-lock-title">{phraseGate && !replacing ? 'Reset with your seed' : (replacing ? 'Set a new wallet password' : (setting ? 'Set a password' : 'Enter wallet password'))}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={dismiss}>
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>
        <form className="field" autoComplete="off" onSubmit={submit}>
          {phraseGate && !replacing ? (
            <>
              <p className="quiet">Enter the 12-word seed for this account. That is the only way to set a new wallet password.</p>
              <PhraseEntry slots={slots} onChange={setSlots} disabled={pending} />
            </>
          ) : null}
          {phraseGate && !replacing ? null : setting ? (
            <SecretDraft
              kind="password"
              label="Password"
              name="desk-password"
              value={password}
              generated={generated}
              copied={copied}
              disabled={record === undefined || pending}
              describedBy="desk-password-rules"
              invalid={Boolean(feedback.problem)}
              onValue={(next) => { setPassword(next); setNote(''); }}
              onFill={(next) => {
                setPassword(next);
                setConfirm(next);
                setNote('');
              }}
              onGenerated={setGenerated}
              onCopied={setCopied}
            />
          ) : (
            <input
              className="desk-unlock"
              type="text"
              name="maelstrom-desk-unlock"
              aria-label="Password"
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              inputMode="text"
              data-1p-ignore="true"
              data-lpignore="true"
              data-form-type="other"
              value={password}
              disabled={record === undefined || pending}
              onChange={event => setPassword(event.target.value)}
            />
          )}
          {setting ? (
            <PasswordFeedback id="desk-password-rules" state={feedback.problem ? 'error' : (password ? 'ok' : '')}>
              {feedback.problem || 'Use 8 to 128 characters.'}
            </PasswordFeedback>
          ) : null}
          {setting ? (
            <label>
              Confirm password
              <input
                type="password"
                name="desk-password-confirm"
                autoComplete="new-password"
                value={confirm}
                aria-describedby="desk-password-match"
                aria-invalid={Boolean(confirm && !feedback.matches) || undefined}
                disabled={pending}
                onChange={(event) => { setConfirm(event.target.value); setNote(''); }}
              />
            </label>
          ) : null}
          {setting ? (
            <PasswordFeedback id="desk-password-match" state={confirm ? (feedback.matches ? 'ok' : 'error') : ''}>
              {feedback.confirmation || 'Re-enter your password to confirm it.'}
            </PasswordFeedback>
          ) : null}
          {note ? <p className="quiet" role="status">{note}</p> : null}
          <button type="submit" className="solid" disabled={record === undefined || pending || (setting && !(phraseGate && !replacing) && (!feedback.ready || !secretAcceptAllowed({ generated, copied })))}>
            {pending ? 'Checking…' : (phraseGate && !replacing ? 'Check seed' : (replacing ? 'Set password' : (setting ? 'Set password' : 'Unlock wallet')))}
          </button>
          <button type="button" className="quiet" onClick={dismiss}>Cancel</button>
          {!setting && !phraseGate ? (
            <button
              type="button"
              className="quiet"
              disabled={pending}
              onClick={() => {
                setPhraseGate(true);
                setReplacing(false);
                setSeedProof('');
                setSlots(Array.from({ length: 12 }, () => ''));
                setPassword('');
                setConfirm('');
                setNote('');
                setGenerated(false);
                setCopied(false);
              }}
            >
              Reset with seed
            </button>
          ) : null}
        </form>
      </section>
    </div>
  );
}
