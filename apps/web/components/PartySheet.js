'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { partyBook, signedUsdc } from '../lib/party-book.mjs';
import AddressCopy from './AddressCopy';
import TxnLog from './TxnLog';
import { usePresence } from './usePresence';

function stamp(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

export default function PartySheet({ open, party, transfers = [], payments = [], onClose, resolve }) {
  const { mounted, leaving } = usePresence(open && Boolean(party));
  const [address, setAddress] = useState('');
  const book = party ? partyBook({ party, transfers, payments }) : null;

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !party || typeof resolve !== 'function') {
      setAddress('');
      return undefined;
    }
    let stop = false;
    Promise.resolve(resolve(party.label)).then((recipient) => {
      if (!stop) setAddress(recipient?.address || '');
    }).catch(() => {
      if (!stop) setAddress('');
    });
    return () => { stop = true; };
  }, [open, party, resolve]);

  if (!mounted || !book) return null;
  const netClass = book.net.startsWith('-') ? 'is-out' : 'is-in';

  return (
    <div className={`backdrop is-center ${leaving ? 'is-leaving' : ''}`} onMouseDown={onClose}>
      <section
        className="sheet party-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="party-title"
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="sheet-head">
          <div>
            <h2 id="party-title">{party.label}</h2>
            {address ? <AddressCopy address={address} /> : <p className="quiet">Platform handle</p>}
          </div>
          <button type="button" className="icon-btn" aria-label="Close counterparty" onClick={onClose}>
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>
        <dl className="party-totals">
          <div>
            <dt>In</dt>
            <dd className="is-in">{signedUsdc(book.inbound)} USDC</dd>
          </div>
          <div>
            <dt>Out</dt>
            <dd className="is-out">{signedUsdc(`-${book.outbound === '0' ? '0' : book.outbound}`)} USDC</dd>
          </div>
          <div>
            <dt>Net</dt>
            <dd className={netClass}>{signedUsdc(book.net)} USDC</dd>
          </div>
        </dl>
        <TxnLog
          rows={book.rows.map(row => ({
            ...row,
            title: row.direction === 'in' ? 'Incoming' : 'Outgoing',
            detail: [row.detail, stamp(row.when)].filter(Boolean).join(' · '),
          }))}
          empty={`No transfers with ${party.label} yet.`}
        />
      </section>
    </div>
  );
}
