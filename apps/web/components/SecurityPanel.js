'use client';

import { useState } from 'react';
import { ArrowUpRight, Bot, KeyRound, LockKeyhole, Pause, ShieldCheck, Snowflake, UnlockKeyhole } from 'lucide-react';
import {
  applySecurityActionLocal,
  buildSecurityPage,
  securityAgentStatus,
} from '../lib/security.mjs';
import { ownerAuthHeaders } from '../lib/owner-auth-headers.mjs';
import { shellRuntimeUrl } from '../lib/runtime-data.mjs';
import SlideCommit from './bits/SlideCommit';
import './SecurityPanel.css';

const ACTION_LOOK = {
  'pause-all': { icon: Pause, title: 'Pause agents', button: 'Pause all' },
  'freeze-all-bots': { icon: Snowflake, title: 'Freeze spending', button: 'Freeze all' },
  'unfreeze-all-bots': { icon: UnlockKeyhole, title: 'Unfreeze spending', button: 'Unfreeze all' },
  'request-grab-back': { icon: ArrowUpRight, title: 'Recover agent funds', button: 'Request recovery' },
};

export default function SecurityPanel({
  bots,
  ownerId = null,
  getAccessToken = null,
  accountLabel = null,
  onBotsChange,
  wallets = null,
  walletUnlocked = false,
  onWalletLocked,
}) {
  const [pending, setPending] = useState(null);
  const [armed, setArmed] = useState(null);
  const [message, setMessage] = useState(null);
  const page = buildSecurityPage({ ownerId, accountLabel, bots });

  function renderAction(action) {
    const look = ACTION_LOOK[action.id];
    const Icon = look.icon;
    const selected = armed?.id === action.id;
    return (
      <div key={action.id} className={`security-control${action.kind === 'danger' ? ' is-danger' : ''}`}>
        <div className="security-control-row">
          <span className="security-control-icon"><Icon size={18} strokeWidth={1.65} aria-hidden="true" /></span>
          <div className="security-control-copy">
            <h3>{look.title}</h3>
            <p>{action.description}</p>
          </div>
          <button
            type="button"
            className="security-action-button"
            disabled={pending != null || !page.signedIn}
            aria-label={action.label}
            aria-expanded={selected}
            aria-controls={selected ? `security-confirm-${action.id}` : undefined}
            onClick={() => { setArmed(selected ? null : action); setMessage(null); }}
          >
            {pending === action.id ? 'Working…' : look.button}
          </button>
        </div>
        {selected ? (
          <div className="security-action-confirm" id={`security-confirm-${action.id}`}>
            <p>{action.confirm}</p>
            <SlideCommit
              label="Slide to confirm"
              doneLabel="Working"
              resetKey={action.id}
              disabled={pending != null}
              onCommit={() => {
                if (action.id === 'request-grab-back' && walletUnlocked !== true) {
                  setArmed(null);
                  onWalletLocked?.();
                  return;
                }
                runAction(action);
              }}
            />
            <button type="button" className="security-cancel" onClick={() => setArmed(null)}>Cancel</button>
          </div>
        ) : null}
      </div>
    );
  }

  async function runAction(action) {
    setArmed(null);
    setPending(action.id);
    setMessage(null);

    if (action.id === 'pause-all' && ownerId) {
      const results = [];
      for (const bot of bots) {
        if (bot.status === 'draft') continue;
        const url = shellRuntimeUrl(`/bots/${encodeURIComponent(bot.id)}/pause`);
        if (!url) continue;
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: await ownerAuthHeaders(ownerId, getAccessToken, {
              'content-type': 'application/json',
            }),
            body: JSON.stringify({ reason: 'kill.stop-all' }),
          });
          results.push(response.status);
        } catch {
          results.push(0);
        }
      }
      setMessage(`Pause requested for ${results.length} agent(s).`);
    } else if (action.id === 'request-grab-back') {
      if (ownerId) {
        try {
          const list = Array.isArray(wallets) ? wallets : [];
          const mainWallet = list.find((w) => w.kind === 'main') || null;
          if (!mainWallet) {
            setMessage('Grab-back needs a provisioned main wallet.');
            setPending(null);
            return;
          }
          const response = await fetch(shellRuntimeUrl('/security/grab-back'), {
            method: 'POST',
            headers: await ownerAuthHeaders(ownerId, getAccessToken, {
              'content-type': 'application/json',
            }),
            body: JSON.stringify({
              dryRun: false,
              mainWallet,
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
    } else if (action.id === 'freeze-all-bots' || action.id === 'unfreeze-all-bots') {
      const freeze = action.id === 'freeze-all-bots';
      if (!ownerId) {
        setMessage('Sign in before freezing agents.');
        setPending(null);
        return;
      }
      const url = shellRuntimeUrl('/api/bots/freeze');
      if (!url) {
        setMessage('Freeze needs the agent runtime.');
        setPending(null);
        return;
      }
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: await ownerAuthHeaders(ownerId, getAccessToken, {
            'content-type': 'application/json',
          }),
          body: JSON.stringify({ frozen: freeze }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setMessage(freeze ? 'The freeze did not save.' : 'The unfreeze did not save.');
          setPending(null);
          return;
        }
        setMessage(freeze
          ? `Froze ${data.count ?? 0} agent(s). New spends stay blocked until you unfreeze them.`
          : `Unfroze ${data.count ?? 0} agent(s). A paused agent stays paused until you resume it.`);
      } catch {
        setMessage(freeze ? 'The freeze did not save.' : 'The unfreeze did not save.');
        setPending(null);
        return;
      }
    }

    if (typeof onBotsChange === 'function') {
      onBotsChange(applySecurityActionLocal(bots, action.id));
    }
    setPending(null);
  }

  return (
    <div className="security-page">
      <header className="security-heading">
        <span className="security-heading-icon"><ShieldCheck size={23} strokeWidth={1.5} aria-hidden="true" /></span>
        <div>
          <p className="security-eyebrow">Account settings</p>
          <h1>Security</h1>
          <p className="security-subtitle">Stay in control of your agents and their spending.</p>
        </div>
      </header>

      <section className="security-overview" aria-label="Account security overview">
        <div className="security-account">
          <div className="security-account-label">
            <span>{page.signedIn ? 'Signed in as' : 'Account'}</span>
            <span className="security-network">{page.cluster}</span>
          </div>
          <strong>{page.accountLabel}</strong>
        </div>
        <dl className="security-metrics">
          <div><dt>Agents</dt><dd>{page.summary.botCount}</dd></div>
          <div><dt>Paused</dt><dd>{page.summary.paused}</dd></div>
          <div><dt>Frozen</dt><dd>{page.summary.frozen}</dd></div>
        </dl>
      </section>

      {!page.signedIn ? <p className="security-notice">Sign in to manage agent security.</p> : null}
      {message ? <p className="security-notice" role="status">{message}</p> : null}

      <div className="security-layout">
        <div className="security-main">
          <section className="security-card" aria-labelledby="security-controls-title">
            <div className="security-section-heading">
              <h2 id="security-controls-title">Agent controls</h2>
              <p>Changes apply to every agent on your account.</p>
            </div>
            {page.actions.filter((action) => action.kind !== 'danger').map(renderAction)}
          </section>

          <section className="security-card security-recovery" aria-labelledby="security-recovery-title">
            <div className="security-section-heading">
              <h2 id="security-recovery-title">Fund recovery</h2>
              <p>A deliberate step, protected by wallet unlock and confirmation.</p>
            </div>
            {page.actions.filter((action) => action.kind === 'danger').map(renderAction)}
          </section>
        </div>
        <aside className="security-aside">
          <section className="security-card" aria-labelledby="security-agents-title">
            <div className="security-section-heading security-agents-heading">
              <h2 id="security-agents-title">Agent status</h2>
              <span>{page.summary.botCount}</span>
            </div>
            {page.bots.length ? (
              <ul className="security-agent-list" tabIndex={0} aria-label="Agent statuses">
                {page.bots.map((bot) => {
                  const status = securityAgentStatus(bot);
                  return (
                    <li key={bot.id}>
                      <span className="security-agent-icon"><Bot size={17} strokeWidth={1.6} aria-hidden="true" /></span>
                      <strong>{bot.name}</strong>
                      <span className={`security-status is-${status.toLowerCase()}`}>{status}</span>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="security-empty">No agents yet. Your agents will appear here when you create one.</p>}
          </section>
          <div className="security-assurance">
            <KeyRound size={17} strokeWidth={1.6} aria-hidden="true" />
            <div><h3>Your keys stay private</h3><p>Wallet keys stay with Privy. Neither this page nor your agents can view them.</p></div>
          </div>
          <div className="security-assurance">
            <LockKeyhole size={17} strokeWidth={1.6} aria-hidden="true" />
            <div><h3>You have the final say</h3><p>Pausing stops agent runs. Freezing blocks new spending until you unfreeze it.</p></div>
          </div>
        </aside>
      </div>
    </div>
  );
}
