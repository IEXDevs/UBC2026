'use client';

import { useEffect, useState } from 'react';
import { formatBaseUnits } from '../lib/money-views.mjs';
import {
  permissionById,
  readReviewThreshold,
  readStoredPermission,
} from '../lib/spend-permission.mjs';
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
  const permit = permissionById(permitState.permission);

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
