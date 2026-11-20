'use client';

import { useEffect, useState } from 'react';
import { buildOverview, pickOwnerRollup } from '../lib/overview.mjs';
import { ownerAuthHeaders } from '../lib/owner-auth-headers.mjs';
import { shellRuntimeUrl } from '../lib/runtime-data.mjs';
import AnimatedList from './AnimatedList';
import { listLook } from './listLook';

export default function OverviewPanel({ bots, ownerId = null, getAccessToken = null }) {
  const [remoteMetric, setRemoteMetric] = useState(null);

  useEffect(() => {
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
        // Keep local-derived overview when the runtime is unreachable.
      }
    }
    load();
    const timer = setInterval(load, 8000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [ownerId, getAccessToken]);

  const overview = buildOverview({ bots, ownerId: ownerId || '', remoteMetric });

  return (
    <div className="overview-page">
      <header className="bot-heading">
        <div className="pill">● Overview · {overview.source === 'runtime' ? 'live' : 'local'}</div>
        <h1>{overview.subtitle}</h1>
      </header>

      <section className="panel overview-pnl" aria-label="Paper PnL">
        <p className="approval-amount">{overview.pnlLabel}</p>
        <p className="hint">Paper PnL (micro-USDC). No trades are placed here.</p>
      </section>

      <section className="panel" aria-label="Owner metrics">
        <h2>Activity</h2>
        <dl className="overview-metrics">
          {overview.cards.map((card) => (
            <div key={card.key}>
              <dt>{card.label}</dt>
              <dd>{card.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="panel" aria-label="Agents">
        <h2>{overview.botCount} agents</h2>
        <AnimatedList
          {...listLook({ maxHeight: 360 })}
          items={overview.bots.map((bot) => ({
            id: bot.id,
            title: bot.name,
            description: bot.type,
            meta: bot.status,
          }))}
        />
      </section>
    </div>
  );
}
