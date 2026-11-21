'use client';

import { useEffect, useState } from 'react';
import { SOLANA_CLUSTER } from '@ubc2026/contracts/solana';
import { sandboxSettleBody, shoppingComparisonView } from '../lib/shopping-comparison.mjs';
import { ownerAuthHeaders } from '../lib/owner-auth-headers.mjs';
import { shellRuntimeUrl } from '../lib/runtime-data.mjs';
import { readLasoBilling, readLasoCards, rememberLasoCard, writeLasoBilling } from '../lib/laso-card-book.mjs';
import LasoCard, { LasoBillingForm } from './LasoCard';
import SlideCommit from './bits/SlideCommit';

/**
 * Shopping bot controls (Isaac / 6B): prepare sandbox or Laso challenge via the Worker.
 * Settlement still requires owner approval + signer on the runtime.
 */
export default function ShoppingPanel({ bot, ownerId = null, getAccessToken = null, onEvent = null }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [armed, setArmed] = useState(false);
  const [settled, setSettled] = useState(false);
  const [billing, setBilling] = useState(null);
  const [cards, setCards] = useState([]);
  const [lasoAmount, setLasoAmount] = useState('5');

  useEffect(() => {
    if (!ownerId || typeof window === 'undefined') return;
    setBilling(readLasoBilling(window.sessionStorage, ownerId));
    setCards(readLasoCards(window.sessionStorage, ownerId));
  }, [ownerId]);

  if (bot?.type !== 'shopping') return null;

  async function prepare(provider, lasoAction = 'setup') {
    setBusy(true);
    setError(null);
      setResult(null);
      setArmed(false);
      setSettled(false);
      try {
      const url = shellRuntimeUrl(`/bots/${encodeURIComponent(bot.id)}/shopping/prepare`);
      if (!ownerId || !url) {
        setError(ownerId ? 'This agent cannot prepare a purchase.' : 'Sign in to prepare a purchase');
        return;
      }
      const walletId = bot.record?.walletId || bot.walletId || '';
      if (!walletId) {
        setError('Assign a provisioned wallet to this agent before shopping.');
        return;
      }
      const body = provider === 'laso'
        ? {
          provider: 'laso',
          lasoAction,
          amountUsd: Number(lasoAmount) || 5,
          ...(billing ? { billing } : {}),
          bot: {
            id: bot.id,
            ownerId,
            name: bot.name,
            goal: bot.goal,
            type: 'shopping',
            enabled: true,
            frozen: false,
            policyVersion: 1,
            approvalMode: 'ask',
            walletId,
            cap: bot.record?.cap || { mode: 'limited', asset: 'USDC', maxOutflow: '20000000', maxPerTransaction: '10000000' },
          },
          ledger: { asset: 'USDC', spent: '0', reserved: '0', realizedLoss: '0' },
        }
        : {
          bot: {
            id: bot.id,
            ownerId,
            name: bot.name,
            goal: bot.goal,
            type: 'shopping',
            enabled: true,
            frozen: false,
            policyVersion: 1,
            approvalMode: 'ask',
            walletId,
            cap: bot.record?.cap || { mode: 'limited', asset: 'USDC', maxOutflow: '10000000', maxPerTransaction: '5000000' },
          },
          ledger: { asset: 'USDC', spent: '0', reserved: '0', realizedLoss: '0' },
          recipient: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        };
      const response = await fetch(url, {
        method: 'POST',
        headers: await ownerAuthHeaders(ownerId, getAccessToken, {
          'content-type': 'application/json',
        }),
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || `prepare_failed_${response.status}`);
        return;
      }
      setResult(data);
      if (data.provider === 'laso' && data.card && ownerId) {
        setCards(rememberLasoCard(window.sessionStorage, ownerId, data.card));
      }
      onEvent?.({
        kind: 'tool.call',
        summary: provider === 'laso'
          ? `Laso tiny-card challenge ready (${data.next})`
          : `Sandbox pick ${data.pick?.item?.name || data.pick?.item?.id} (${data.next})`,
      });
    } catch (err) {
      setError(err?.message || 'prepare_failed');
    } finally {
      setBusy(false);
    }
  }

  async function settle(prepared) {
    const body = sandboxSettleBody(prepared, bot);
    const url = shellRuntimeUrl(`/bots/${encodeURIComponent(bot.id)}/shopping/settle`);
    if (!body || !url || !ownerId) {
      setError(ownerId ? 'This proposal cannot be bought from here.' : 'Sign in to approve a purchase');
      setArmed(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: await ownerAuthHeaders(ownerId, getAccessToken, {
          'content-type': 'application/json',
        }),
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error === 'signer_not_configured'
          ? 'Buying needs the signer on the server.'
          : 'The sandbox buy did not go through.');
        setArmed(false);
        return;
      }
      setSettled(true);
      setArmed(false);
      onEvent?.({
        kind: 'tool.call',
        summary: `Sandbox order ${data.order?.orderId || 'placed'}`,
      });
    } catch {
      setError('The sandbox buy did not go through.');
      setArmed(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-label="Shopping">
      <h2>Shopping</h2>
      <p className="hint">
        Compare the x402 sandbox catalog on price and quality, or open a Laso card challenge.
        The result is a proposal. Nothing is bought until you approve.
        {SOLANA_CLUSTER === 'mainnet-beta' ? ' Sandbox purchases are unavailable.' : null}
      </p>
      <div className="live-actions">
        <button className="cta" type="button" disabled={busy || SOLANA_CLUSTER === 'mainnet-beta'} onClick={() => prepare('sandbox')}>
          {busy ? 'Working…' : 'Compare catalog'}
        </button>
        <button className="ghost" type="button" disabled={busy} onClick={() => prepare('laso', 'setup')}>
          Set up Laso card
        </button>
        <button className="ghost" type="button" disabled={busy} onClick={() => prepare('laso', 'modify')}>
          Add card funds
        </button>
      </div>
      <div className="laso-cards">
        <h3>Laso cards</h3>
        <p className="hint">One billing address is used on every card. Agents set up and add funds by following the x402 quote.</p>
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
          <input value={lasoAmount} onChange={event => setLasoAmount(event.target.value)} inputMode="decimal" />
        </label>
        {cards.map(card => (
          <LasoCard
            key={card.id}
            card={card}
            billing={billing}
            onPay={(payment) => onEvent?.({
              kind: 'tool.call',
              summary: `Laso card $${payment.amountUsd} at ${payment.merchant}`,
            })}
          />
        ))}
      </div>
      {error ? <p className="hint" role="alert">{error}</p> : null}
      {result ? (
        <ShoppingProposal
          result={result}
          bot={bot}
          busy={busy}
          armed={armed}
          settled={settled}
          onArm={() => { setError(null); setArmed(true); }}
          onCancel={() => setArmed(false)}
          onSettle={() => settle(result)}
        />
      ) : null}
    </section>
  );
}

function ShoppingProposal({ result, bot, busy, armed, settled, onArm, onCancel, onSettle }) {
  const settleBody = sandboxSettleBody(result, bot);
  const comparison = shoppingComparisonView(result);
  return (
    <>
      {comparison ? (
        <div>
          <p className="hint">{comparison.ask}</p>
          <p className="hint">{comparison.title}. {comparison.reason}</p>
          <ol className="why-related" aria-label="Ranked shopping proposal">
            {comparison.rows.map((row) => (
              <li key={row.id}>
                {row.role === 'proposal' ? 'Proposal' : 'Compared'}
                {' · '}
                {row.name}
                {' · '}
                {row.price}
                {row.quality != null ? ` · quality ${row.quality}` : ''}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      <dl className="approval-facts">
        <div>
          <dt>Provider</dt>
          <dd>{result.provider || 'sandbox'}</dd>
        </div>
        {!settled ? (
          <div>
            <dt>Next</dt>
            <dd>{result.next}</dd>
          </div>
        ) : null}
        {result.pick?.item ? (
          <div>
            <dt>Pick</dt>
            <dd>{result.pick.item.name} · {result.pick.item.price}</dd>
          </div>
        ) : null}
        {result.proposal?.outflow ? (
          <div>
            <dt>Outflow</dt>
            <dd>{result.proposal.outflow} base units</dd>
          </div>
        ) : null}
      </dl>
      {settled ? <p className="hint" role="status">Sandbox order is in.</p> : null}
      {!settled && settleBody ? (
        armed ? (
          <div className="security-confirm">
            <p>Slide to buy this sandbox item.</p>
            <SlideCommit
              label="Slide to confirm"
              doneLabel="Buying"
              disabled={busy}
              resetKey={settleBody.itemId}
              onCommit={onSettle}
            />
            <button type="button" className="ghost" disabled={busy} onClick={onCancel}>Cancel</button>
          </div>
        ) : (
          <div className="live-actions">
            <button className="ghost" type="button" disabled={busy} onClick={onArm}>Approve sandbox buy</button>
          </div>
        )
      ) : null}
    </>
  );
}
