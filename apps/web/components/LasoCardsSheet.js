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
  writeLasoBilling,
} from '../lib/laso-card-book.mjs';

export default function LasoCardsSheet({ open, onClose, ownerId = '' }) {
  const { mounted, leaving } = usePresence(open);
  const [billing, setBilling] = useState(null);
  const [cards, setCards] = useState([]);
  const [claim, setClaim] = useState('');

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
        <p className="quiet">Agents set these up. One billing address is used on every card.</p>
        <div className="laso-cards">
          {cards.length === 0 ? <p className="quiet">No cards yet.</p> : cards.map(card => (
            <LasoCard key={card.id} card={card} billing={billing} />
          ))}
          {claim ? (
            <p className="voice-note" role="status">
              <a href={claim} target="_blank" rel="noreferrer">Open the Laso dashboard</a>
              {' · One-time login link, expires in 15 minutes.'}
            </p>
          ) : null}
          <details className="laso-billing-fold">
            <summary>Billing address</summary>
            <LasoBillingForm
              key={`${ownerId || 'signed-out'}:${billing?.postalCode || ''}`}
              value={billing}
              onSave={(next) => {
                if (!ownerId) return;
                setBilling(writeLasoBilling(window.sessionStorage, ownerId, next));
              }}
            />
          </details>
        </div>
      </motion.section>
    </div>,
    document.body,
  );
}
