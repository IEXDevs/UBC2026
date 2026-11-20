'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import ModalClose from './ModalClose';
import SecretDraft from './SecretDraft';
import PasswordFeedback from './PasswordFeedback';
import { passwordFeedback } from '../lib/password-feedback.mjs';
import { createDeskLock, passwordProblem } from '../lib/desk-lock.mjs';
import { acceptEnteredPassword, readDeskLockState, saveDeskVerifier } from '../lib/desk-grant-client.mjs';
import { secretAcceptAllowed } from '../lib/secret-generate.mjs';
import { blockCopy } from '../lib/block-copy.mjs';
import { PhraseEntry } from './RecoveryCeremony';
import { phraseProof, readRecoveryState, verifyRecovery } from '../lib/recovery-vault.mjs';

function controlValue(form, name) {
  const node = form?.elements?.namedItem?.(name);
  return node && typeof node.value === 'string' ? node.value : '';
}

export default function DeskLock({ ownerId, onUnlock, onClose, onSignOut, getAccessToken }) {
  const [status, setStatus] = useState('checking');
  const [attempt, setAttempt] = useState(0);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [copied, setCopied] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [phraseGate, setPhraseGate] = useState(false);
  const [slots, setSlots] = useState(() => Array.from({ length: 12 }, () => ''));
  const [seedProof, setSeedProof] = useState('');
  const active = useRef(false);
  const unlockInput = useRef(null);
  const tokenReader = useRef(getAccessToken);
  tokenReader.current = getAccessToken;
  useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, [ownerId]);
  const dismiss = useCallback(() => {
    active.current = false;
    onClose?.();
  }, [onClose]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      controller.abort();
      setStatus('unavailable');
    }, 12000);
    setStatus('checking');
    setPassword('');
    setConfirm('');
    setNote('');
    setGenerated(false);
    setCopied(false);
    setReplacing(false);
    setPhraseGate(false);
    setSlots(Array.from({ length: 12 }, () => ''));
    setSeedProof('');
    (async () => {
      try {
        const token = await tokenReader.current?.();
        if (controller.signal.aborted) return;
        const state = token ? await readDeskLockState(fetch, { ownerId, token, signal: controller.signal }) : null;
        if (!controller.signal.aborted) setStatus(state?.ok ? (state.locked ? 'configured' : 'missing') : 'unavailable');
      } catch {
        if (!controller.signal.aborted) setStatus('unavailable');
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [ownerId, attempt]);

  useEffect(() => {
    if (!onClose) return undefined;
    function onKey(event) {
      if (event.key === 'Escape') dismiss();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, dismiss]);

  const setting = replacing || status === 'missing';
  const passwordForm = status === 'configured' || status === 'missing';
  const feedback = passwordFeedback(password, confirm, passwordProblem(password));
  const title = !passwordForm ? 'Unlock your desk'
    : replacing ? 'Set a new desk password'
    : phraseGate ? 'Reset with your seed'
    : setting ? 'Set a desk password'
    : 'Unlock your desk';

  function clearUnlockPassword() {
    const input = unlockInput.current;
    if (!input || input.disabled) return;
    input.value = '';
    setPassword('');
    setNote('');
    input.focus();
  }

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
    if (pending || !passwordForm) return;
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
      const token = await getAccessToken?.();
      if (!active.current) return;
      if (!token) {
        setNote('Could not confirm your sign-in. Try again.');
        setPending(false);
        return;
      }
      if (setting) {
        const created = await createDeskLock(nextPassword);
        if (!active.current) return;
        if (replacing && !seedProof) {
          setNote('Enter the 12-word seed for this account before setting a new password.');
          setPending(false);
          return;
        }
        const registered = await saveDeskVerifier(fetch, {
          localStorage: window.localStorage,
          ownerId,
          token,
          verifier: created,
          replace: replacing,
          proof: replacing ? seedProof : '',
        });
        if (!active.current) return;
        if (registered.exists) {
          setStatus('configured');
          setReplacing(false);
          setPhraseGate(false);
          setPassword('');
          setConfirm('');
          setNote('This account already has a desk password. Enter that password.');
          setPending(false);
          return;
        }
        if (!registered.ok) {
          setNote('Could not save your desk password. Try again.');
          setPending(false);
          return;
        }
        setStatus('configured');
        setPhraseGate(false);
        setReplacing(false);
      }
      const accepted = await acceptEnteredPassword({
        fetchImpl: fetch,
        ownerId,
        token,
        password: nextPassword,
        sessionStorage: window.sessionStorage,
        shouldAccept: () => active.current,
      }).catch(() => ({ ok: false }));
      if (!active.current) return;
      if (!accepted.ok) {
        const message = setting ? 'Password saved. Enter it to unlock your desk.'
          : accepted.error === 'desk_locked' ? 'Wrong password.'
          : 'Could not unlock your desk. Try again.';
        setNote(message);
        if (setting) {
          setPassword('');
          setConfirm('');
        }
        setPending(false);
        return;
      }
      setPassword('');
      setConfirm('');
      setPending(false);
      onUnlock?.(accepted.until);
    } catch {
      if (!active.current) return;
      setNote('Could not unlock your desk. Try again.');
      setPending(false);
    }
  }

  async function signOut() {
    setNote('');
    setPending(true);
    try {
      await onSignOut();
    } catch {
      if (active.current) setNote('Could not sign out. Try again.');
    } finally {
      if (active.current) setPending(false);
    }
  }

  return (
    <div className="backdrop is-center desk-lock no-copy" onMouseDown={onClose ? dismiss : undefined} onCopy={blockCopy} onCut={blockCopy}>
      <section
        className="sheet wallet-gate"
        role="dialog"
        aria-modal="true"
        aria-labelledby="desk-lock-title"
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="sheet-head">
          <h2 id="desk-lock-title">{title}</h2>
          {onClose ? (
            <ModalClose label="Close wallet password" onClick={dismiss} />
          ) : null}
        </div>
        {!passwordForm ? (
          <>
            <p className="quiet" role="status">
              {status === 'checking' ? 'Checking your desk…' : 'Could not load your desk password status.'}
            </p>
            {status === 'unavailable' ? (
              <button type="button" className="solid" disabled={pending} onClick={() => setAttempt(value => value + 1)}>Try again</button>
            ) : null}
          </>
        ) : (
          <form className="field" autoComplete="off" onSubmit={submit}>
            {phraseGate && !replacing ? (
              <>
                <p className="quiet">Enter the 12-word seed for this account to reset your desk password.</p>
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
                disabled={pending}
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
              <div className="desk-unlock-row">
                <input
                  ref={unlockInput}
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
                  disabled={pending}
                  onChange={event => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  className="ghost"
                  aria-label="Clear password"
                  disabled={pending}
                  onClick={clearUnlockPassword}
                >
                  Clear
                </button>
              </div>
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
            <button type="submit" className="solid" disabled={pending || (setting && !(phraseGate && !replacing) && (!feedback.ready || !secretAcceptAllowed({ generated, copied })))}>
              {pending ? 'Checking…' : setting ? 'Set password and unlock' : phraseGate ? 'Check seed' : 'Unlock desk'}
            </button>
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
            {phraseGate && !replacing ? (
              <button type="button" className="quiet" disabled={pending} onClick={() => { setPhraseGate(false); setNote(''); }}>Back to password</button>
            ) : null}
          </form>
        )}
        {!passwordForm && note ? <p className="quiet" role="status">{note}</p> : null}
        {onClose ? <button type="button" className="quiet" onClick={dismiss}>Cancel</button> : (
          <button type="button" className="quiet" disabled={pending} onClick={signOut}>Sign out</button>
        )}
      </section>
    </div>
  );
}
