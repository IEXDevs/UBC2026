'use client';

import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { normalizeDisplayName, normalizeHandle } from '@ubc2026/contracts';
import { claimLookupVerdict, claimSaveNote, handleAlreadyClaimed } from '../lib/profile.mjs';
import { shellRuntimeUrl } from '../lib/runtime-data.mjs';

const BURST = [
  { c: '#7c5cff', w: 8, h: 14, dx: '-120px', dy: '-86px', spin: '-40deg' },
  { c: '#3dd68c', w: 7, h: 12, dx: '132px', dy: '-70px', spin: '28deg' },
  { c: '#f5f5f5', w: 6, h: 16, dx: '-40px', dy: '-120px', spin: '18deg' },
  { c: '#7c5cff', w: 10, h: 10, dx: '70px', dy: '-110px', spin: '-22deg' },
  { c: '#3dd68c', w: 6, h: 14, dx: '160px', dy: '-18px', spin: '36deg' },
  { c: '#f5f5f5', w: 8, h: 8, dx: '-168px', dy: '-16px', spin: '-16deg' },
  { c: '#7c5cff', w: 5, h: 12, dx: '28px', dy: '-140px', spin: '48deg' },
  { c: '#3dd68c', w: 9, h: 6, dx: '-90px', dy: '-130px', spin: '-30deg' },
  { c: '#f5f5f5', w: 6, h: 11, dx: '108px', dy: '-132px', spin: '12deg' },
  { c: '#7c5cff', w: 7, h: 7, dx: '-150px', dy: '-96px', spin: '24deg' },
  { c: '#3dd68c', w: 5, h: 10, dx: '148px', dy: '-108px', spin: '-44deg' },
  { c: '#f5f5f5', w: 8, h: 5, dx: '-20px', dy: '-150px', spin: '8deg' },
];

export default function ClaimHandle({ accountLabel = '', ownerId = '', onSave, onContinue }) {
  const [displayName, setDisplayName] = useState(accountLabel || '');
  const [handle, setHandle] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [verdict, setVerdict] = useState('idle');
  const [checked, setChecked] = useState('');
  const [welcome, setWelcome] = useState(null);
  const typed = normalizeHandle(handle) || '';
  const invalid = handle.trim().length > 0 && !typed;
  const name = normalizeDisplayName(displayName);
  const open = verdict === 'open' && checked === typed;
  const ready = Boolean(name) && open && !pending;

  useEffect(() => {
    if (!typed) {
      setVerdict('idle');
      setChecked('');
      return undefined;
    }
    const controller = new AbortController();
    setVerdict('checking');
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(shellRuntimeUrl(`/api/profiles/lookup?q=${encodeURIComponent(`@${typed}`)}`), {
          headers: ownerId ? { 'x-owner-id': ownerId } : {},
          cache: 'no-store',
          signal: controller.signal,
        });
        const found = await response.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        setVerdict(claimLookupVerdict(response.status, found));
        setChecked(typed);
      } catch (error) {
        if (error?.name === 'AbortError') return;
        setVerdict('error');
        setChecked(typed);
      }
    }, 420);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [typed, ownerId]);

  async function submit(event) {
    event.preventDefault();
    if (!ready) return;
    setPending(true);
    setNote('');
    try {
      const saved = await onSave({ displayName: name, handle: typed, avatarUrl: null });
      if (saved?.ok === false || handleAlreadyClaimed(saved)) {
        setVerdict('taken');
        setChecked(typed);
        setPending(false);
        return;
      }
      if (!saved || saved.ok !== true) {
        setNote('Could not save that handle.');
        setPending(false);
        return;
      }
      setWelcome({ handle: typed, displayName: name });
    } catch (error) {
      const taken = error?.code === 'handle_taken' || error?.error === 'handle_taken';
      if (taken) {
        setVerdict('taken');
        setChecked(typed);
      } else {
        setNote(claimSaveNote(error));
      }
      setPending(false);
    }
  }

  if (welcome) {
    return (
      <div className="backdrop is-center is-claim">
        <div className="claim-welcome" role="dialog" aria-modal="true" aria-labelledby="claim-welcome-title">
          <div className="claim-confetti" aria-hidden="true">
            {BURST.map((piece, index) => (
              <i
                key={piece.dx + piece.dy}
                style={{
                  '--c': piece.c,
                  '--w': `${piece.w}px`,
                  '--h': `${piece.h}px`,
                  '--dx': piece.dx,
                  '--dy': piece.dy,
                  '--spin': piece.spin,
                  animationDelay: `${index * 18}ms`,
                }}
              />
            ))}
          </div>
          <h2 id="claim-welcome-title">Welcome, {welcome.displayName}.</h2>
          <div className="claim-plate">
            <span className="claim-plate__shine" aria-hidden="true" />
            <p className="claim-plate__handle">@{welcome.handle}</p>
          </div>
          <button type="button" className="solid" onClick={onContinue}>Continue</button>
        </div>
      </div>
    );
  }

  const status = invalid
    ? { tone: 'error', text: 'Use 2–32 letters, numbers, or underscores.' }
    : claimStatus(verdict, typed, checked);

  return (
    <div className="backdrop is-center is-claim">
      <form className="sheet wallet-gate claim-form" onSubmit={submit} aria-labelledby="claim-title">
        <h2 id="claim-title">Claim your handle to get paid{typed ? ` @${typed}` : ''}</h2>
        <label className="field">
          Display name
          <input value={displayName} onChange={event => setDisplayName(event.target.value)} autoComplete="name" required />
        </label>
        <label className="field">
          Handle
          <input
            value={handle}
            onChange={event => {
              setHandle(event.target.value.replace(/^@+/, ''));
              setNote('');
            }}
            placeholder="@handle"
            autoComplete="off"
            spellCheck="false"
            aria-invalid={status?.tone === 'taken' || undefined}
            aria-describedby={status ? 'claim-handle-status' : undefined}
            required
          />
        </label>
        {status ? (
          <p id="claim-handle-status" className={`claim-status is-${status.tone}`} role="status">
            {status.tone === 'open' ? <Check size={16} strokeWidth={2.4} aria-hidden="true" /> : null}
            {status.tone === 'taken' || status.tone === 'error' ? <X size={16} strokeWidth={2.4} aria-hidden="true" /> : null}
            <span>{status.text}</span>
          </p>
        ) : null}
        {note ? <p className="claim-status is-error" role="alert">{note}</p> : null}
        <button className="solid" type="submit" disabled={!ready}>{pending ? 'Claiming…' : 'Claim handle'}</button>
      </form>
    </div>
  );
}

function claimStatus(verdict, typed, checked) {
  if (!typed || verdict === 'idle') return null;
  if (verdict === 'checking' || checked !== typed) return { tone: 'checking', text: `Checking @${typed}` };
  if (verdict === 'open') return { tone: 'open', text: `@${typed} is available` };
  if (verdict === 'taken') return { tone: 'taken', text: 'Pick another one.' };
  return { tone: 'error', text: 'Could not check that handle.' };
}
