'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import SecretDraft from './SecretDraft';
import {
  createDeskLock,
  passwordProblem,
  readDeskLock,
  unlockDesk,
  writeDeskGrant,
  writeDeskLock,
} from '../lib/desk-lock.mjs';
import { openDeskGrant, readDeskLockState, registerDeskVerifier } from '../lib/desk-grant-client.mjs';
import { secretAcceptAllowed } from '../lib/secret-generate.mjs';

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
    (async () => {
      const token = typeof getAccessToken === 'function' ? await getAccessToken() : '';
      const state = await readDeskLockState(fetch, { ownerId, token }).catch(() => ({ locked: false }));
      if (!stopped && state.locked) setServerLocked(true);
    })();
    return () => { stopped = true; };
  }, [ownerId, getAccessToken]);

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose?.();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const setting = replacing || (record == null && !serverLocked);

  async function submit(event) {
    event.preventDefault();
    if (pending || record === undefined) return;
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
      if (setting) {
        const created = await createDeskLock(nextPassword);
        const registered = await registerDeskVerifier(fetch, {
          ownerId,
          token,
          verifier: created,
          replace: replacing,
        });
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
        setRecord(created);
        setReplacing(false);
      } else if (record) {
        const ok = await unlockDesk(nextPassword, record);
        if (!ok) {
          setNote('Wrong password.');
          setPending(false);
          return;
        }
      }
      const opened = await openDeskGrant(fetch, { ownerId, token, password: nextPassword });
      if (!opened.ok || !writeDeskGrant(window.sessionStorage, ownerId, opened.grant, opened.until)) {
        setNote('The password was not accepted for spends.');
        setPending(false);
        return;
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
    <div className="backdrop is-center desk-lock" onMouseDown={() => onClose?.()}>
      <section
        className="sheet wallet-gate"
        role="dialog"
        aria-modal="true"
        aria-labelledby="desk-lock-title"
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="sheet-head">
          <h2 id="desk-lock-title">{replacing ? 'Reset password' : (setting ? 'Set a password' : 'Enter Password')}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={() => onClose?.()}>
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>
        <form className="field" autoComplete="off" onSubmit={submit}>
          {setting ? (
            <SecretDraft
              kind="password"
              label="Password"
              name="desk-password"
              value={password}
              generated={generated}
              copied={copied}
              disabled={record === undefined || pending}
              onValue={setPassword}
              onFill={(next) => {
                setPassword(next);
                setConfirm(next);
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
            <label>
              Confirm password
              <input
                type="password"
                name="desk-password-confirm"
                autoComplete="new-password"
                value={confirm}
                disabled={pending}
                onChange={event => setConfirm(event.target.value)}
              />
            </label>
          ) : null}
          {note ? <p className="quiet" role="status">{note}</p> : null}
          <button type="submit" className="solid" disabled={record === undefined || pending || (setting && !secretAcceptAllowed({ generated, copied }))}>
            {pending ? 'Checking…' : (replacing ? 'Reset password' : (setting ? 'Set password' : 'Unlock'))}
          </button>
          {!setting ? (
            <button
              type="button"
              className="quiet"
              disabled={pending}
              onClick={() => {
                setReplacing(true);
                setPassword('');
                setConfirm('');
                setNote('');
                setGenerated(false);
                setCopied(false);
              }}
            >
              Reset password
            </button>
          ) : null}
        </form>
      </section>
    </div>
  );
}
