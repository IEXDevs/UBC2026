'use client';

import { useState } from 'react';
import { copyText } from '../lib/copy-text.mjs';
import { shortAddress } from '../lib/money-views.mjs';

export default function AddressCopy({ address, prefix = '', className = '' }) {
  const [note, setNote] = useState('');
  const clipped = shortAddress(address);
  const shown = prefix ? `${prefix}(${clipped})` : clipped;

  async function copy() {
    if (!address) return;
    try {
      const ok = await copyText(address);
      setNote(ok ? 'Copied' : 'Copy failed');
    } catch {
      setNote('Copy failed');
    }
    window.setTimeout(() => setNote(''), 1200);
  }

  if (!address) return <span className={`address-copy is-empty ${className}`.trim()}>No address</span>;

  return (
    <button type="button" className={`address-copy ${className}`.trim()} onClick={copy} aria-label={`Copy ${address}`}>
      <span>{shown}</span>
      <small>{note || 'Copy'}</small>
    </button>
  );
}
