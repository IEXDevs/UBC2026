'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { motion } from 'motion/react';
import ModalClose from './ModalClose';
import LasoCard, { LasoBillingForm } from './LasoCard';
import { usePresence } from './usePresence';
import {
  LASO_CARDS_EVENT,
  readLasoBilling,
  readLasoCards,
  readLasoClaim,
  rememberLasoTransactions,
  setLasoLabel,
  writeLasoBilling,
} from '../lib/laso-card-book.mjs';

export default function LasoCardsSheet({ open, onClose, ownerId = '', botId = '', getAccessToken = null }) {
  const { mounted, leaving } = usePresence(open);
  const [billing, setBilling] = useState(null);
  const [cards, setCards] = useState([]);
  const [claim, setClaim] = useState('');
  const [refreshingId, setRefreshingId] = useState('');
  const [revealingId, setRevealingId] = useState('');
  const [secrets, setSecrets] = useState({});
  const [error, setError] = useState('');
  const hideTimers = useRef({});
  useEffect(() => () => {
    const timers = hideTimers.current;
    Object.values(timers).forEach(clearTimeout);
  }, []);

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

  async function refreshCard(cardId) {
    if (!cardId || !botId || !ownerId) {
      setError(!botId ? 'Open a chat with an agent first, then refresh.' : 'Sign in to refresh.');
      return;
    }
    setError('');
    setRefreshingId(cardId);
    try {
      let token = '';
      try { token = (await getAccessToken?.()) || ''; } catch {}
      const res = await fetch(`/api/runtime/bots/${encodeURIComponent(botId)}/laso/status?view=card&card_id=${encodeURIComponent(cardId)}`, {
        headers: {
          'x-owner-id': ownerId,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          cache: 'no-store',
        },
        cache: 'no-store',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.error) {
        setError(body?.error === 'laso_session_expired' ? 'Laso session expired. Open the dashboard link from chat, then try again.' : 'Refresh failed. Try again from chat with laso_status.');
        return;
      }
      const data = body?.card || {};
      const txs = Array.isArray(data.transactions) ? data.transactions : [];
      const next = rememberLasoTransactions(window.sessionStorage, ownerId, cardId, {
        transactions: txs,
        updatedAt: Date.now(),
        status: typeof data.status === 'string' ? data.status : null,
        amountUsd: data.balance ?? data.on_card_usd_amount ?? data.usd_amount ?? null,
        expiry: typeof data.expiry === 'string' ? data.expiry : null,
        last4: typeof data.last4 === 'string' ? data.last4 : null,
      });
      setCards(next);
    } catch {
      setError('Refresh failed. Try again.');
    } finally {
      setRefreshingId('');
    }
  }

  function hideCard(cardId) {
    if (hideTimers.current[cardId]) {
      clearTimeout(hideTimers.current[cardId]);
      delete hideTimers.current[cardId];
    }
    setSecrets(current => {
      if (!current[cardId]) return current;
      const next = { ...current };
      delete next[cardId];
      return next;
    });
    setRevealingId(current => (current === cardId ? '' : current));
  }

  function scheduleHide(cardId) {
    if (hideTimers.current[cardId]) clearTimeout(hideTimers.current[cardId]);
    hideTimers.current[cardId] = setTimeout(() => hideCard(cardId), 30000);
  }

  async function revealCard(cardId) {
    if (!cardId || !botId || !ownerId) {
      setError(!botId ? 'Open a chat with an agent first, then Show.' : 'Sign in to show card details.');
      return;
    }
    if (secrets[cardId]?.pan) {
      hideCard(cardId);
      return;
    }
    setError('');
    setRevealingId(cardId);
    try {
      let token = '';
      try { token = (await getAccessToken?.()) || ''; } catch {}
      const res = await fetch(`/api/runtime/bots/${encodeURIComponent(botId)}/laso/reveal?card_id=${encodeURIComponent(cardId)}`, {
        headers: {
          'x-owner-id': ownerId,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          cache: 'no-store',
        },
        cache: 'no-store',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.error) {
        if (body?.error === 'laso_session_expired') setError('Laso session expired. Open the dashboard link from chat, then try Show again.');
        else if (body?.needs_approval) setError('Card issuer needs holder approval by email before releasing the number. Check the inbox, approve, then Show again.');
        else setError('Could not pull card details from Laso. Try Refresh first, then Show again.');
        return;
      }
      if (!body?.card_number) {
        setError('Laso returned no card details for this card. Read the number on the dashboard link.');
        return;
      }
      setSecrets(current => ({ ...current, [cardId]: { pan: body.card_number, cvv: body.cvv || '', expiry: body.expiry || '' } }));
      scheduleHide(cardId);
    } catch {
      setError('Could not pull card details from Laso. Try again.');
    } finally {
      setRevealingId(current => (current === cardId ? '' : current));
    }
  }

  function renameCard(cardId, label) {
    if (!ownerId || !cardId) return;
    setCards(setLasoLabel(window.sessionStorage, ownerId, cardId, label));
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
        <p className="quiet">Agents set these up. One billing address is used on every card. Ask the owner for a name when a card is created.</p>
        {error ? <p className="quiet" role="alert">{error}</p> : null}
        <div className="laso-cards">
          {cards.length === 0 ? <p className="quiet">No cards yet.</p> : cards.map(card => (
            <div key={card.id}>
              <LasoCard card={card} billing={billing} secret={secrets[card.id] || null} onReveal={() => revealCard(card.id)} onHide={() => hideCard(card.id)} revealing={revealingId === card.id} onRefresh={refreshCard} refreshing={refreshingId === card.id} />
              <form
                className="laso-rename"
                onSubmit={event => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  renameCard(card.id, String(data.get('label') || ''));
                }}
              >
                <input name="label" defaultValue={card.label || ''} placeholder="Name this card (asked at setup)" maxLength={40} autoComplete="off" />
                <button className="ghost" type="submit">Save name</button>
              </form>
            </div>
          ))}
          {claim ? (
            <p className="voice-note" role="status">
              <a href={claim} target="_blank" rel="noreferrer">Open the Laso dashboard</a>
              {' · One-time login link, expires in 15 minutes.'}
            </p>
          ) : null}
          <details className="laso-billing-fold">
            <summary>
              <strong>Billing address</strong>
              <ChevronDown size={16} aria-hidden="true" />
            </summary>
            <div className="laso-billing-body">
            <LasoBillingForm
              key={`${ownerId || 'signed-out'}:${billing?.postalCode || ''}`}
              value={billing}
              onSave={(next) => {
                if (!ownerId) return;
                setBilling(writeLasoBilling(window.sessionStorage, ownerId, next));
              }}
            />
            </div>
          </details>
        </div>
      </motion.section>
    </div>,
    document.body,
  );
}
