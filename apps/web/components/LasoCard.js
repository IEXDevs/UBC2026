'use client';

import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import {
  billingAddress,
  cardCanPay,
  formatBillingAddress,
  payWithVirtualCard,
  presentLasoCard,
} from '@ubc2026/shopping/laso-card.mjs';
import './LasoCard.css';

function formatTxDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 16);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function txAmount(row) {
  const raw = row?.amount ?? row?.usd_amount ?? row?.value ?? null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return '';
  const sign = n < 0 ? '-' : n > 0 ? '+' : '';
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

export default function LasoCard({ card, billing = null, secret = null, onPay = null, onRefresh = null, refreshing = false, onReveal = null, onHide = null, revealing = false }) {
  const [revealed, setRevealed] = useState(false);
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);
  const [tempShow, setTempShow] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  const source = secret?.pan ? { ...card, ...secret } : card;
  let face;
  try {
    face = presentLasoCard(source, { reveal: revealed || tempShow, billing });
  } catch {
    return null;
  }
  const payable = cardCanPay(face);
  const label = face.label || card?.label || card?.name || face.id;
  const txs = Array.isArray(face.transactions) && face.transactions.length > 0 ? face.transactions : (Array.isArray(card?.transactions) ? card.transactions : []);
  const expiry = face.expiry && face.expiry !== 'XX/XX' ? face.expiry : (card?.expiry || 'XX/XX');
  const lastRefreshed = face.updatedAt || card?.updatedAt || null;
  const lastRefreshedText = lastRefreshed ? new Date(lastRefreshed).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not refreshed yet';
  const hasSecret = Boolean(secret?.pan);
  const eyeOpen = hasSecret ? revealed : (revealed || tempShow);

  function unblock(autoHideMs = 30000) {
    setTempShow(true);
    if (timer.current) window.clearTimeout(timer.current);
    if (autoHideMs > 0) {
      timer.current = window.setTimeout(() => {
        setTempShow(false);
        setCopied(false);
      }, autoHideMs);
    }
  }

  function onEye() {
    if (eyeOpen) {
      if (timer.current) window.clearTimeout(timer.current);
      setTempShow(false);
      setRevealed(false);
      setCopied(false);
      onHide?.();
      return;
    }
    // No secret yet: pull the real PAN/CVV from Laso via the owner-only
    // reveal endpoint (live API, never the model). The eye then unblocks
    // the real number for 30 seconds.
    if (!hasSecret) {
      onReveal?.();
      return;
    }
    setCopied(false);
    unblock(30000);
    setRevealed(true);
  }

  function copyNumber() {
    const text = face.number;
    try {
      if (navigator?.clipboard?.writeText) void navigator.clipboard.writeText(text).catch(() => {});
    } catch {}
    setCopied(true);
    unblock(30000);
  }

  function pay(event) {
    event.preventDefault();
    setNote('');
    try {
      const payment = payWithVirtualCard({
        card: source,
        billing,
        merchant,
        amountUsd: amount,
      });
      onPay?.(payment);
      setNote(`Authorized $${payment.amountUsd} at ${payment.merchant}.`);
      setMerchant('');
      setAmount('');
    } catch (error) {
      setNote(error?.code === 'billing_required' || error?.code === 'billing_country'
        ? 'Add the billing address used for every card.'
        : error?.code === 'card_not_ready'
          ? 'This card can pay after the x402 quote is confirmed.'
          : 'Enter a merchant and an amount.');
    }
  }

  return (
    <article className="laso-card">
      <div className="laso-card-head">
        <div>
          <strong>{label}</strong>
          <p className="quiet" style={{ margin: 0 }}>
            {face.amountUsd != null ? `$${Number(face.amountUsd).toFixed(2)} USD` : ''}
            {' · Last refreshed '}{lastRefreshedText}
          </p>
          <p className="quiet" style={{ margin: 0 }}>Balance + status: live Laso status API. Name: asked at setup.</p>
        </div>
        {onRefresh ? (
          <button type="button" className="ghost" onClick={() => onRefresh?.(face.id)} disabled={refreshing} title="Pull live card + transactions from Laso">
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        ) : null}
      </div>
      <div className="laso-card-face">
        <div className="laso-card-top">
          <span className="laso-chip" aria-hidden="true" />
          <span className="laso-brand">Laso</span>
          <button
            type="button"
            aria-pressed={eyeOpen}
            aria-label={eyeOpen ? 'Hide card details' : 'Show card details'}
            title={hasSecret ? (eyeOpen ? 'Hide again' : 'Show real number for 30 seconds') : 'Pull real number from Laso'}
            onClick={onEye}
            disabled={revealing}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            {eyeOpen ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
            {revealing ? 'Pulling\u2026' : eyeOpen ? 'Hide' : 'Show'}
          </button>
        </div>
        <p className="laso-number" onClick={copyNumber} title="Click to copy number" style={{ cursor: 'copy' }} role="button" tabIndex={0} onKeyDown={event => { if (event.key === 'Enter') copyNumber(); }}>{face.number}</p>
        {copied ? <p className="quiet" role="status">Copied. Hides again in 30 seconds.</p> : null}
        {eyeOpen && hasSecret ? <p className="quiet" role="status">Live from Laso. Hides again in 30 seconds, never saved.</p> : null}
        {eyeOpen && !hasSecret ? <p className="quiet" role="status">Unblocked for 30 seconds. Pulling live from Laso.</p> : null}
        <div className="laso-card-bottom">
          <span><small>Name</small>{face.holder}</span>
          <span><small>Expires</small>{expiry}</span>
          <span><small>CVV</small>{face.cvv}</span>
        </div>
        <div className="laso-card-bottom">
          <span><small>Card ID</small>{face.id}</span>
          <span><small>Last4</small>{face.last4 ?? 'XXXX'}</span>
        </div>
      </div>
      <div className="laso-billing">
        <p className="quiet">{face.billing ? formatBillingAddress(face.billing) : 'Every card uses the same billing address.'}</p>
        <p className="quiet">Billing: owner entry, not from Laso. {face.status === 'pending' ? 'Pending. Agents set this up with the x402 quote.' : `${face.kind} · ${face.status} (live API)`}</p>
      </div>
      <details className="laso-tx-fold">
        <summary><strong>Transactions</strong><span className="quiet">{txs.length > 0 ? ` (${txs.length})` : ''} · live API</span></summary>
        <div className="laso-tx-body">
          {txs.length === 0 ? (
            <p className="quiet">No transactions yet. Hit Refresh to pull live from Laso.</p>
          ) : txs.map((row, i) => (
            <div key={`${row?.date || ''}-${i}`} className="laso-tx-row">
              <div>
                <strong>{row?.merchant || row?.description || 'Transaction'}</strong>
                <p className="quiet" style={{ margin: 0 }}>{formatTxDate(row?.date)}{row?.status ? ` · ${row.status}` : ''}</p>
              </div>
              <span>{txAmount(row)}</span>
            </div>
          ))}
        </div>
      </details>
      {payable ? (
        <form className="laso-pay" onSubmit={pay}>
          <label>
            Merchant
            <input value={merchant} onChange={event => setMerchant(event.target.value)} autoComplete="off" />
          </label>
          <label>
            Amount (USD)
            <input value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" autoComplete="off" />
          </label>
          <button className="wallet-export" type="submit">Pay with this card</button>
          {note ? <p className="quiet" role="status">{note}</p> : null}
        </form>
      ) : null}
    </article>
  );
}

export function LasoBillingForm({ value, onSave }) {
  const [draft, setDraft] = useState(value || {
    name: '', line1: '', line2: '', city: '', region: '', postalCode: '', country: '',
  });
  const [note, setNote] = useState('');

  function update(field) {
    return event => setDraft(current => ({ ...current, [field]: event.target.value }));
  }

  function save(event) {
    event.preventDefault();
    try {
      const shared = billingAddress({ ...draft, country: draft.country.toUpperCase() });
      onSave(shared);
      setNote('Saved. Every Laso card uses this address.');
    } catch {
      setNote('Name, street, city, region, postal code, and a two-letter country are required.');
    }
  }

  return (
    <form className="laso-fields" onSubmit={save}>
      <label className="wide">Name<input value={draft.name} onChange={update('name')} autoComplete="name" /></label>
      <label className="wide">Street<input value={draft.line1} onChange={update('line1')} autoComplete="address-line1" /></label>
      <label className="wide">Street 2<input value={draft.line2} onChange={update('line2')} autoComplete="address-line2" /></label>
      <label>City<input value={draft.city} onChange={update('city')} autoComplete="address-level2" /></label>
      <label>Region<input value={draft.region} onChange={update('region')} autoComplete="address-level1" /></label>
      <label>Postal code<input value={draft.postalCode} onChange={update('postalCode')} autoComplete="postal-code" /></label>
      <label>Country<input value={draft.country} onChange={update('country')} maxLength={2} autoComplete="country" /></label>
      <button className="ghost" type="submit">Save billing address</button>
      {note ? <p className="quiet" role="status">{note}</p> : null}
    </form>
  );
}
