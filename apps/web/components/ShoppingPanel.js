'use client';

import { useState } from 'react';
import { shoppingComparisonView } from '../lib/shopping-comparison.mjs';
import { ownerAuthHeaders } from '../lib/owner-auth-headers.mjs';
import { shellRuntimeUrl } from '../lib/runtime-data.mjs';

/**
 * Shopping bot controls (Isaac / 6B): prepare sandbox or Laso challenge via the Worker.
 * Settlement still requires owner approval + signer on the runtime.
 */
export default function ShoppingPanel({ bot, ownerId = null, getAccessToken = null, onEvent = null }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  if (bot?.type !== 'shopping') return null;

  async function prepare(provider) {
    setBusy(true);
    setError(null);
    setResult(null);
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
          amountUsd: 5,
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
          recipient: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
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

  return (
    <section className="panel" aria-label="Shopping">
      <h2>Shopping</h2>
      <p className="hint">
        Compare the x402 sandbox catalog on price and quality, or open a tiny Laso mainnet card challenge.
        The result is a proposal. Nothing is bought until you approve.
      </p>
      <div className="live-actions">
        <button className="cta" type="button" disabled={busy} onClick={() => prepare('sandbox')}>
          {busy ? 'Working…' : 'Compare catalog'}
        </button>
        <button className="ghost" type="button" disabled={busy} onClick={() => prepare('laso')}>
          Laso $5 card challenge
        </button>
      </div>
      {error ? <p className="hint" role="alert">{error}</p> : null}
      {result ? <ShoppingProposal result={result} /> : null}
    </section>
  );
}

function ShoppingProposal({ result }) {
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
        <div>
          <dt>Next</dt>
          <dd>{result.next}</dd>
        </div>
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
    </>
  );
}
