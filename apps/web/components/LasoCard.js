'use client';

import { useState } from 'react';
import {
  billingAddress,
  cardCanPay,
  formatBillingAddress,
  payWithVirtualCard,
  presentLasoCard,
} from '@ubc2026/shopping/laso-card.mjs';
import './LasoCard.css';

export default function LasoCard({ card, billing = null, secret = null, onPay = null }) {
  const [revealed, setRevealed] = useState(false);
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const source = secret?.pan ? { ...card, ...secret } : card;
  let face;
  try {
    face = presentLasoCard(source, { reveal: revealed, billing });
  } catch {
    return null;
  }
  const payable = cardCanPay(face);

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
      <div className="laso-card-face">
        <div className="laso-card-top">
          <span className="laso-chip" aria-hidden="true" />
          <span className="laso-brand">Laso</span>
          <button
            type="button"
            aria-pressed={face.revealed}
            disabled={!face.canReveal}
            onClick={() => setRevealed(value => !value)}
          >
            {face.canReveal ? (face.revealed ? 'Hide' : 'Show') : 'Hidden'}
          </button>
        </div>
        <p className="laso-number">{face.number}</p>
        <div className="laso-card-bottom">
          <span><small>Name</small>{face.holder}</span>
          <span><small>Expires</small>{face.expiry}</span>
          <span><small>CVV</small>{face.cvv}</span>
        </div>
      </div>
      <div className="laso-billing">
        <p className="quiet">{face.billing ? formatBillingAddress(face.billing) : 'Every card uses the same billing address.'}</p>
        <p className="quiet">{face.status === 'pending' ? 'Pending. Agents set this up with the x402 quote.' : `${face.kind} · ${face.status}`}</p>
      </div>
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
