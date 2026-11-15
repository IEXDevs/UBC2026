'use client';

import { useEffect, useState } from 'react';
import SecretDraft from './SecretDraft';
import {
  DESK_LOCK_IDLE_MS,
  createDeskLock,
  passwordProblem,
  readDeskLock,
  unlockDesk,
  writeDeskLock,
} from '../lib/desk-lock.mjs';
import { secretAcceptAllowed } from '../lib/secret-generate.mjs';

const idleMinutes = Math.round(DESK_LOCK_IDLE_MS / 60000);

export default function DeskLock({ ownerId, accountLabel = '', onUnlock }) {
  const [record, setRecord] = useState(undefined);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
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
    setAcknowledged(false);
  }, [ownerId]);

  const setting = record == null;
  const who = accountLabel && accountLabel !== 'You' ? accountLabel : '';

  async function submit(event) {
    event.preventDefault();
    if (pending || record === undefined) return;
    setNote('');
    if (setting) {
      const problem = passwordProblem(password);
      if (problem) {
        setNote(problem);
        return;
      }
      if (password !== confirm) {
        setNote('Those passwords do not match.');
        return;
      }
      if (!secretAcceptAllowed({ generated, copied, acknowledged })) {
        setNote('Copy the generated password or passphrase, or confirm that you copied it.');
        return;
      }
    }
    setPending(true);
    try {
      if (setting) {
        const created = await createDeskLock(password);
        writeDeskLock(window.localStorage, ownerId, created);
        setRecord(created);
      } else {
        const ok = await unlockDesk(password, record);
        if (!ok) {
          setNote('Wrong password.');
          setPending(false);
          return;
        }
      }
      setPassword('');
      setConfirm('');
      onUnlock?.();
    } catch {
      setNote('The password could not be saved on this browser.');
      setPending(false);
    }
  }

  return (
    <div className="backdrop is-center desk-lock">
      <section className="sheet wallet-gate" role="dialog" aria-modal="true" aria-labelledby="desk-lock-title">
        <h2 id="desk-lock-title">{setting ? 'Set a password' : 'Unlock Maelstrom'}</h2>
        <p className="quiet">
          {who ? `Signed in as ${who}. ` : 'You stay signed in. '}
          {setting
            ? `This password unlocks wallets, sends, and agents. A reload asks for it again, and so does ${idleMinutes} minutes of idle time.`
            : `Enter it to use wallets, sends, and agents. A reload asks again, and so does ${idleMinutes} minutes of idle time.`}
        </p>
        <form className="field" onSubmit={submit}>
          {setting ? (
            <SecretDraft
              label="Password"
              name="desk-password"
              value={password}
              generated={generated}
              copied={copied}
              acknowledged={acknowledged}
              disabled={record === undefined || pending}
              onValue={setPassword}
              onFill={(next) => {
                setPassword(next);
                setConfirm(next);
              }}
              onGenerated={setGenerated}
              onCopied={setCopied}
              onAcknowledged={setAcknowledged}
            />
          ) : (
            <label>
              Password
              <input
                type="password"
                name="desk-password"
                autoFocus
                autoComplete="current-password"
                value={password}
                disabled={record === undefined || pending}
                onChange={event => setPassword(event.target.value)}
              />
            </label>
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
          <button type="submit" className="solid" disabled={record === undefined || pending || (setting && !secretAcceptAllowed({ generated, copied, acknowledged }))}>
            {pending ? 'Checking…' : (setting ? 'Set password' : 'Unlock')}
          </button>
        </form>
      </section>
    </div>
  );
}
