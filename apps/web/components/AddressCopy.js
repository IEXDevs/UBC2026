'use client';

import { useEffect, useRef, useState } from 'react';
import { copyText } from '../lib/copy-text.mjs';
import { shortAddress } from '../lib/money-views.mjs';

export default function AddressCopy({ address, prefix = '', className = '', compact = false, dotted = false, inline = false }) {
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(0);
  const timer = useRef(null);
  const request = useRef(0);
  const discoverable = dotted || inline;
  const clipped = shortAddress(address);
  const shown = prefix ? `${prefix} (${clipped})` : clipped;

  useEffect(() => {
    setNote('');
    return () => {
      request.current += 1;
      window.clearTimeout(timer.current);
    };
  }, [address]);

  async function copy(event) {
    if (discoverable) event.stopPropagation();
    if (!address) return;
    const current = ++request.current;
    window.clearTimeout(timer.current);
    let next = 'Copy failed';
    try {
      const ok = await copyText(address);
      next = ok ? 'Copied' : 'Copy failed';
    } catch {
      // Leave the failure visible without exposing clipboard errors.
    }
    if (current !== request.current) return;
    setNote(next);
    setCopied(value => value + 1);
    timer.current = window.setTimeout(() => setNote(''), 1200);
  }

  if (!address) return <span className={`address-copy is-empty ${className}`.trim()}>No address</span>;

  return (
    <button type="button" className={`address-copy${compact ? ' is-compact' : ''}${discoverable ? ' is-dotted' : ''}${inline ? ' is-inline' : ''} ${className}`.trim()} onClick={copy} aria-label={`Copy ${address}`} title={discoverable ? 'Copy address' : undefined}>
      <span className="address-copy-label">{shown}</span>
      {discoverable ? <>
        {compact || inline ? null : <small>Copy</small>}
        <span className="address-copy-status" role="status" aria-live="polite" aria-atomic="true">
          {note ? <small key={copied} className="address-copy-feedback">{note}</small> : null}
        </span>
      </> : compact ? (note ? <small>{note}</small> : null) : <small>{note || 'Copy'}</small>}
    </button>
  );
}
