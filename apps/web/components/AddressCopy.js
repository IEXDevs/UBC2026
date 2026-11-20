'use client';

import { useEffect, useRef, useState } from 'react';
import { copyText } from '../lib/copy-text.mjs';
import { shortAddress } from '../lib/money-views.mjs';

export default function AddressCopy({ address, prefix = '', className = '', compact = false, inline = false }) {
  const [note, setNote] = useState('');
  const [attempt, setAttempt] = useState(0);
  const timer = useRef(null);
  const request = useRef(0);
  const clipped = shortAddress(address);
  const shown = prefix ? `${prefix} (${clipped})` : clipped;

  useEffect(() => {
    setNote('');
    return () => {
      window.clearTimeout(timer.current);
      request.current += 1;
    };
  }, [address]);

  async function copy(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!address) return;
    const current = ++request.current;
    window.clearTimeout(timer.current);
    let ok = false;
    try {
      ok = await copyText(address);
    } catch { /* Keep failure feedback local to this control. */ }
    if (request.current !== current) return;
    setAttempt(value => value + 1);
    setNote(ok ? 'Copied' : 'Copy failed');
    timer.current = window.setTimeout(() => setNote(''), 1800);
  }

  if (!address) return <span className={`address-copy is-empty ${className}`.trim()}>No address</span>;

  return (
    <button type="button" className={`address-copy${compact ? ' is-compact' : ''}${inline ? ' is-inline' : ''} ${className}`.trim()} data-state={note === 'Copied' ? 'copied' : note ? 'error' : undefined} onClick={copy} aria-label={`Copy ${address}`} title="Copy wallet address">
      <span className="address-copy-text">{shown}</span>
      <small key={attempt} className="address-copy-feedback" role="status">{note || (compact || inline ? '' : 'Copy')}</small>
    </button>
  );
}
