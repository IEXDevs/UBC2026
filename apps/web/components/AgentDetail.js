'use client';

import { useEffect, useState } from 'react';
import { formatBaseUnits } from '../lib/money-views.mjs';
import {
  permissionById,
  readReviewThreshold,
  readStoredPermission,
} from '../lib/spend-permission.mjs';
import { agentRunCall, signalOfferView } from '../lib/owner-actions.mjs';
import { ownerAuthHeaders } from '../lib/owner-auth-headers.mjs';
import { shellRuntimeUrl } from '../lib/runtime-data.mjs';
import BotMark from './BotMark';
import FileLibrary from './FileLibrary';
import LiveViewPanel from './LiveViewPanel';

function readPermitState() {
  if (typeof localStorage === 'undefined') {
    return { permission: 'ask', reviewCapLabel: '' };
  }
  const permission = readStoredPermission(localStorage);
  const cap = readReviewThreshold(localStorage);
  let reviewCapLabel = '';
  if (cap) {
    try { reviewCapLabel = formatBaseUnits(cap); } catch { reviewCapLabel = ''; }
  }
  return { permission, reviewCapLabel };
}

export default function AgentDetail({
  bot,
  files = [],
  ownerId = null,
  getAccessToken = null,
  onResize,
  onMissingFile,
  onComputer,
}) {
  const [permitState, setPermitState] = useState(() => readPermitState());
  const [runBusy, setRunBusy] = useState('');
  const [runNote, setRunNote] = useState('');
  const permit = permissionById(permitState.permission);
  const offer = signalOfferView(bot);

  async function runAgent(action) {
    const call = agentRunCall(action, bot);
    const url = call ? shellRuntimeUrl(call.path) : null;
    if (!call || !url || !ownerId) {
      setRunNote('Sign in to run this agent.');
      return;
    }
    setRunBusy(action);
    setRunNote('');
    try {
      const response = await fetch(url, {
        method: call.method,
        headers: await ownerAuthHeaders(ownerId, getAccessToken, {
          'content-type': 'application/json',
        }),
        body: JSON.stringify(call.body),
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const code = typeof data.error === 'string' ? data.error : '';
        setRunNote(code === 'login_required' || code === 'owner_required'
          ? 'Sign in to run this agent.'
          : 'That did not start.');
        return;
      }
      setRunNote(action === 'wake' ? 'This agent is awake.' : 'The goal is running.');
    } catch {
      setRunNote('That did not start.');
    } finally {
      setRunBusy('');
    }
  }

  useEffect(() => {
    function refresh() {
      setPermitState(readPermitState());
    }
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    const timer = setInterval(refresh, 1500);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
      clearInterval(timer);
    };
  }, []);

  return (
    <aside className="agent-detail" aria-label={`${bot.name} details`}>
      <div
        className="pane-resize is-left"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize details"
        onPointerDown={onResize}
      />
      <header className="agent-detail-head is-agent">
        <BotMark shape={bot.shape} color={bot.color} image={bot.image} name={bot.name} size={56} />
        <div className="agent-detail-copy">
          <strong>{bot.name}</strong>
          <span className="agent-detail-meta">
            <span className="agent-detail-perm-line">
              <span className={`agent-detail-perm is-${permit.id}`} style={{ '--perm-color': permit.color }}>
                {permit.label}
              </span>
              {permit.id === 'review' && permitState.reviewCapLabel ? (
                <span className="agent-detail-cap">≤ {permitState.reviewCapLabel} USDC</span>
              ) : null}
            </span>
          </span>
        </div>
      </header>

      <section className="side-computer" aria-label="Computer">
        <h3>Computer</h3>
        <LiveViewPanel
          botId={bot.id}
          ownerId={ownerId}
          getAccessToken={getAccessToken}
          screen
          onExpand={onComputer}
        />
        <div className="agent-run">
          <button className="live-chip" type="button" disabled={runBusy !== ''} onClick={() => runAgent('wake')}>
            {runBusy === 'wake' ? 'Waking…' : 'Wake'}
          </button>
          <button className="live-chip" type="button" disabled={runBusy !== ''} onClick={() => runAgent('loop')}>
            {runBusy === 'loop' ? 'Starting…' : 'Run the goal'}
          </button>
        </div>
        {runNote ? <p className="hint" role="status">{runNote}</p> : null}
        {offer ? (
          <p className="hint">
            <a href={offer.href} target="_blank" rel="noreferrer">
              Signal {offer.signalId} · {offer.amountLabel} USDC
            </a>
          </p>
        ) : null}
      </section>

      <FileLibrary
        files={files}
        ownerId={ownerId}
        getAccessToken={getAccessToken}
        onMissing={onMissingFile}
      />
    </aside>
  );
}
