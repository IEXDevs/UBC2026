'use client';

import { useState } from 'react';
import {
  applySecurityActionLocal,
  buildSecurityPage,
  pauseAllUrl,
} from '../lib/security.mjs';
import AnimatedList from './AnimatedList';
import { listLook } from './listLook';

const runtimeBase = process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL ?? '';

export default function SecurityPanel({
  bots,
  ownerId = null,
  accountLabel = null,
  onBotsChange,
  wallets = null,
}) {
  const [pending, setPending] = useState(null);
  const [message, setMessage] = useState(null);
  const page = buildSecurityPage({ ownerId, accountLabel, bots });

  async function runAction(action) {
    if (!window.confirm(action.confirm)) return;
    setPending(action.id);
    setMessage(null);

    if (action.id === 'pause-all' && ownerId && runtimeBase) {
      const results = [];
      for (const bot of bots) {
        if (bot.status === 'draft') continue;
        const url = pauseAllUrl(runtimeBase, bot.id);
        if (!url) continue;
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-owner-id': ownerId,
            },
            body: JSON.stringify({ reason: 'kill.stop-all' }),
          });
          results.push(response.status);
        } catch {
          results.push(0);
        }
      }
      setMessage(`Pause requested for ${results.length} bot(s).`);
    } else if (action.id === 'request-grab-back') {
      if (ownerId && runtimeBase) {
        try {
          const list = Array.isArray(wallets) ? wallets : [];
          const mainWallet = list.find((w) => w.kind === 'main') || null;
          const response = await fetch(`${runtimeBase.replace(/\/$/, '')}/security/grab-back`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-owner-id': ownerId,
            },
            body: JSON.stringify({
              dryRun: !mainWallet,
              mainWallet: mainWallet || { id: 'main_demo', ownerId, label: 'main', kind: 'main', address: '11111111111111111111111111111111', frozen: false, provider: 'privy' },
              wallets: list.filter((w) => w.kind === 'additional'),
            }),
          });
          const data = await response.json();
          if (!response.ok) setMessage(`Grab-back: ${data.error || response.status}`);
          else setMessage(data.dryRun
            ? `Grab-back planned for ${data.moves?.length ?? 0} wallet(s). Connect wallets to sign.`
            : `Grab-back submitted: ${data.moves?.length ?? 0} move(s).`);
        } catch (err) {
          setMessage(`Grab-back failed: ${err?.message || 'network'}`);
        }
      } else {
        setMessage('Grab-back needs runtime URL and sign-in.');
      }
    } else if (action.id === 'freeze-all-bots') {
      setMessage('Bots frozen in this session. Persist freeze via bot policy when API is live.');
    }

    if (typeof onBotsChange === 'function') {
      onBotsChange(applySecurityActionLocal(bots, action.id));
    }
    setPending(null);
  }

  return (
    <div className="security-page">
      <header className="bot-heading">
        <div className="pill">● Security · {page.signedIn ? 'owner' : 'demo'}</div>
        <h1>{page.subtitle}</h1>
      </header>

      <section className="panel" aria-label="Account">
        <h2>Account</h2>
        <dl className="approval-facts">
          <div>
            <dt>Signed in as</dt>
            <dd>{page.accountLabel}</dd>
          </div>
          <div>
            <dt>Cluster</dt>
            <dd>{page.cluster}</dd>
          </div>
          <div>
            <dt>Bots</dt>
            <dd>{page.summary.enabled} enabled · {page.summary.paused} paused · {page.summary.frozen} frozen</dd>
          </div>
        </dl>
      </section>

      <section className="panel security-actions" aria-label="Kill switch">
        <h2>Kill switch</h2>
        <div className="live-actions">
          {page.actions.map((action) => (
            <button
              key={action.id}
              type="button"
              className={action.kind === 'danger' ? 'cta danger' : action.kind === 'warn' ? 'ghost warn' : 'ghost'}
              disabled={pending != null}
              onClick={() => runAction(action)}
            >
              {pending === action.id ? 'Working…' : action.label}
            </button>
          ))}
        </div>
        {message ? <p className="hint" role="status">{message}</p> : null}
      </section>

      <section className="panel" aria-label="Bot freezes">
        <h2>Bot freezes</h2>
        <AnimatedList
          {...listLook({ maxHeight: 320 })}
          items={page.bots.map((bot) => ({
            id: bot.id,
            title: bot.name,
            description: bot.status,
            meta: bot.frozen ? 'Frozen' : bot.enabled ? 'Enabled' : 'Disabled',
          }))}
        />
      </section>

      <section className="panel" aria-label="Notes">
        <h2>Guarantees</h2>
        <AnimatedList
          {...listLook({ maxHeight: 280, selectOnHover: false })}
          items={page.notes.map((note, index) => ({ id: index, title: note }))}
        />
      </section>
    </div>
  );
}
