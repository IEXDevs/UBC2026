'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import ModalClose from './ModalClose';
import AccountStats from './AccountStats';
import { pickOwnerRollup } from '../lib/overview.mjs';
import { ownerAuthHeaders } from '../lib/owner-auth-headers.mjs';
import { shellRuntimeUrl } from '../lib/runtime-data.mjs';
import { profileStats, statisticsView } from '../lib/statistics.mjs';
import BranchedMenu from './BranchedMenu';
import CountUp from './CountUp';
import { usePresence } from './usePresence';

function leafLabel(row) {
  if (row.text) {
    return (
      <span className="stat-leaf">
        <span>{row.label}</span>
        <span className="stat-num">{row.text}</span>
      </span>
    );
  }
  return (
    <span className="stat-leaf">
      <span>{row.label}</span>
      <CountUp
        key={`${row.key}-${row.value}`}
        className="stat-num"
        to={row.value}
        decimals={row.decimals}
        duration={1.05}
        trigger="load"
      />
    </span>
  );
}

export default function StatisticsSheet({
  open,
  onClose,
  bots = [],
  ownerId = null,
  getAccessToken = null,
  voiceMs = 0,
  talks = {},
  payments = [],
  transfers = [],
}) {
  const { mounted, leaving } = usePresence(open);
  const [remoteMetric, setRemoteMetric] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const url = shellRuntimeUrl('/api/metrics');
    if (!url || !ownerId) return undefined;
    let stop = false;
    async function load() {
      try {
        const response = await fetch(url, {
          headers: await ownerAuthHeaders(ownerId, getAccessToken),
          cache: 'no-store',
        });
        const data = await response.json();
        if (stop || !response.ok || data.stub) return;
        const rollup = pickOwnerRollup(data, ownerId);
        if (rollup) setRemoteMetric(rollup);
      } catch {
        // Keep the stored counts when the runtime is unreachable.
      }
    }
    load();
    const timer = setInterval(load, 8000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [open, ownerId, getAccessToken]);

  if (!mounted || typeof document === 'undefined') return null;

  const view = statisticsView({
    bots,
    ownerId: ownerId || '',
    remoteMetric,
    voiceMs,
  });
  const items = [
    {
      value: 'owner',
      label: 'All agents',
      children: view.ownerRows.map(row => ({
        value: `owner-${row.key}`,
        label: leafLabel(row),
      })),
    },
    ...view.agents.map(agent => ({
      value: agent.id,
      label: agent.label,
      children: agent.rows.map(row => ({
        value: `${agent.id}-${row.key}`,
        label: leafLabel(row),
      })),
    })),
  ];

  return createPortal(
    <div className={`backdrop is-center ${leaving ? 'is-leaving' : ''}`} onMouseDown={onClose}>
      <section
        className="stats-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="statistics-title"
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="stats-head">
          <h2 id="statistics-title">Statistics</h2>
          <ModalClose label="Close statistics" onClick={onClose} />
        </div>
        <p className="stats-note">{view.note}</p>
        <AccountStats rows={profileStats({ voiceMs, talks, payments, transfers })} />
        <div className="stats-tree">
          <BranchedMenu
            items={items}
            defaultOpen={items.map((_, index) => index)}
            width={640}
            rowHeight={40}
            fontSize={15}
            color="#f5f5f5"
            accentColor="#f5f5f5"
            lineColor="#3a3a3a"
          />
        </div>
        <p className="quiet">{bots.length} agents on this account.</p>
      </section>
    </div>, document.body,
  );
}
