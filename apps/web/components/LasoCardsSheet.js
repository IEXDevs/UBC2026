'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import ModalClose from './ModalClose';
import LasoCard, { LasoBillingForm } from './LasoCard';
import { usePresence } from './usePresence';
import {
  LASO_CARDS_EVENT,
  readLasoBilling,
  readLasoCards,
  readLasoClaim,
  rememberLasoCard,
  writeLasoBilling,
} from '../lib/laso-card-book.mjs';
import { lasoQuoteBody, shoppingBotForCards } from '../lib/laso-quote.mjs';
import { ownerAuthHeaders } from '../lib/owner-auth-headers.mjs';
import { shellRuntimeUrl } from '../lib/runtime-data.mjs';

export default function LasoCardsSheet({ open, onClose, ownerId = '', getAccessToken = null, bot = null, bots = [] }) {
  const { mounted, leaving } = usePresence(open);
  const [billing, setBilling] = useState(null);
  const [cards, setCards] = useState([]);
  const [claim, setClaim] = useState('');
  const [amount, setAmount] = useState('5');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const shop = shoppingBotForCards(bot, bots);

  function reload() {
    if (!ownerId || typeof window === 'undefined') {
      setBilling(null);
      setCards([]);
      setClaim('');
      return;
    }
    setBilling(readLasoBilling(window.sessionStorage, ownerId));
    setCards(readLasoCards(window.sessionStorage, ownerId));
    setClaim(readLasoClaim(window.sessionStorage, ownerId));
  }

  useEffect(() => {
    if (open) reload();
  }, [open, ownerId]);

  useEffect(() => {
    function onCards(event) {
      if (!ownerId || event.detail?.ownerId === ownerId) reload();
    }
    window.addEventListener(LASO_CARDS_EVENT, onCards);
    return () => window.removeEventListener(LASO_CARDS_EVENT, onCards);
  }, [ownerId]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event) { if (event.key === 'Escape') onClose?.(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  async function quote(lasoAction) {
    setNote('');
    const body = lasoQuoteBody(shop, ownerId, { lasoAction, amountUsd: amount, billing });
    const url = body ? shellRuntimeUrl(`/bots/${encodeURIComponent(shop.id)}/shopping/prepare`) : '';
    if (!body || !url) {
      setNote(ownerId ? 'A shopping agent with a wallet has to request the card.' : 'Sign in to open your cards.');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: await ownerAuthHeaders(ownerId, getAccessToken, { 'content-type': 'application/json' }),
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNote('The card quote did not come back.');
        return;
      }
      if (data.card) rememberLasoCard(window.sessionStorage, ownerId, data.card);
      setNote(lasoAction === 'modify' ? 'The add-funds quote is ready for you to confirm.' : 'The card quote is ready for you to confirm.');
    } catch {
      setNote('The card quote did not come back.');
    } finally {
      setBusy(false);
    }
  }

  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(
    <div className={`backdrop is-center ${leaving ? 'is-leaving' : ''}`} onMouseDown={onClose}>
      <motion.section
        className="laso-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Cards"
        onMouseDown={event => event.stopPropagation()}
        initial={leaving ? false : { opacity: 0, y: 36, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        <ModalClose label="Close cards" onClick={onClose} />
        <p className="plugin-kicker">Cards</p>
        <h2>Laso cards</h2>
        <p className="quiet">One billing address is used on every card. Show reveals a number only on this screen, and only when it is already here.</p>
        <div className="laso-cards">
          <LasoBillingForm
            key={`${ownerId || 'signed-out'}:${billing?.postalCode || ''}`}
            value={billing}
            onSave={(next) => {
              if (!ownerId) return;
              setBilling(writeLasoBilling(window.sessionStorage, ownerId, next));
            }}
          />
          <label className="hint">
            Quote amount (USD)
            <input value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" />
          </label>
          <div className="live-actions">
            <button className="ghost" type="button" disabled={busy} onClick={() => quote('setup')}>Set up a card</button>
            <button className="ghost" type="button" disabled={busy} onClick={() => quote('modify')}>Add funds</button>
          </div>
          {cards.length === 0 ? <p className="quiet">No cards yet.</p> : cards.map(card => (
            <LasoCard key={card.id} card={card} billing={billing} />
          ))}
          {claim ? (
            <p className="voice-note" role="status">
              <a href={claim} target="_blank" rel="noreferrer">Open the Laso dashboard</a>
              {' · One-time login link, expires in 15 minutes.'}
            </p>
          ) : null}
          {note ? <p className="quiet" role="status">{note}</p> : null}
        </div>
      </motion.section>
    </div>,
    document.body,
  );
}
