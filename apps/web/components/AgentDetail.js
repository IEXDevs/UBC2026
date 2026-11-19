'use client';

import { useEffect, useState } from 'react';
import { computerStatus, countOpenBrowserSessions } from '../lib/computer-status.mjs';
import { browserSessionUrl } from '../lib/live-view.mjs';
import { formatBaseUnits } from '../lib/money-views.mjs';
import { ownerAuthHeaders } from '../lib/owner-auth-headers.mjs';
import {
  permissionById,
  readReviewThreshold,
  readStoredPermission,
} from '../lib/spend-permission.mjs';
import BotMark from './BotMark';
import FileLibrary from './FileLibrary';
import LiveViewPanel from './LiveViewPanel';

function statusLabel(status) {
  if (status === 'watching') return 'Working';
  if (status === 'paused') return 'Paused';
  if (status === 'draft') return 'Draft';
  if (typeof status === 'string' && status.trim()) return status;
  return 'Idle';
}

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
  const [openSessionCount, setOpenSessionCount] = useState(0);
  const [permitState, setPermitState] = useState(() => readPermitState());
  const permit = permissionById(permitState.permission);
  const work = statusLabel(bot?.status);
  const machine = computerStatus({ openSessionCount, botStatus: bot?.status });

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

  useEffect(() => {
    setOpenSessionCount(0);
    const url = browserSessionUrl('shell', bot?.id);
    if (!url || !ownerId) return undefined;
    let stop = false;
    async function load() {
      try {
        const response = await fetch(url, {
          headers: await ownerAuthHeaders(ownerId, getAccessToken),
          cache: 'no-store',
        });
        const data = await response.json().catch(() => ({}));
        if (stop || !response.ok) return;
        setOpenSessionCount(countOpenBrowserSessions(data));
      } catch {
        /* Keep the last known computer label when the runtime is unreachable. */
      }
    }
    load();
    const timer = setInterval(load, 4000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [bot?.id, ownerId, getAccessToken]);

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
            <span className={`agent-detail-perm is-${permit.id}`} style={{ '--perm-color': permit.color }}>
              {permit.label}
            </span>
            {permit.id === 'review' && permitState.reviewCapLabel ? (
              <span className="agent-detail-cap">≤ {permitState.reviewCapLabel} USDC</span>
            ) : null}
            <span className={`agent-detail-work is-${(bot.status || 'idle').replace(/\s+/g, '-')}`}>
              {work}
            </span>
          </span>
        </div>
      </header>

      <section className="side-computer" aria-label="Computer">
        <h3>Computer</h3>
        <button type="button" className="side-option" onClick={() => onComputer?.()}>
          <span>
            <strong>{bot.name}&apos;s computer</strong>
            <small>{machine}</small>
          </span>
          <span className={`side-option-mark${machine === 'Asleep' ? ' is-asleep' : ''}`}>
            <BotMark shape={bot.shape} color={bot.color} image={bot.image} name={bot.name} size={28} />
            {machine === 'Asleep' ? <span className="side-option-sleep">z</span> : null}
          </span>
        </button>
        <LiveViewPanel
          botId={bot.id}
          ownerId={ownerId}
          getAccessToken={getAccessToken}
          screen
          onExpand={onComputer}
        />
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
