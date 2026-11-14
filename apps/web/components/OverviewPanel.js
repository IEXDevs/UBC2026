'use client';

import { useEffect, useState } from 'react';
import { buildOverview, metricsUrl, pickOwnerRollup } from '../lib/overview.mjs';

const runtimeBase = process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL ?? '';

export default function OverviewPanel({ bots, ownerId = null }) {
  const [remoteMetric, setRemoteMetric] = useState(null);

  useEffect(() => {
    const url = metricsUrl(runtimeBase);
    if (!url || !ownerId) return undefined;
    let stop = false;
    async function load() {
      try {
        const response = await fetch(url, {
          headers: { 'x-owner-id': ownerId },
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
  }, [ownerId]);

  const overview = buildOverview({ bots, ownerId: ownerId ?? 'demo_owner', remoteMetric });

  return (
    <div className="overview-page">
      <header className="bot-heading">
        <div className="pill">● Overview · {overview.source === 'runtime' ? 'live' : 'local'}</div>
        <h1>{overview.subtitle}</h1>
      </header>

      <section className="panel overview-pnl" aria-label="Paper PnL">
        <p className="approval-amount">{overview.pnlLabel}</p>
        <p className="hint">Owner paper PnL (micro-USDC rollup). Mainnet prices, no live settle here.</p>
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

      <section className="panel" aria-label="Bots">
        <h2>{overview.botCount} bots</h2>
        <ul className="overview-bots">
          {overview.bots.map((bot) => (
            <li key={bot.id}>
              <strong>{bot.name}</strong>
              <span>{bot.type} · {bot.status}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
