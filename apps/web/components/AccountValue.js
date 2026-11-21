'use client';

import { useEffect, useState } from 'react';
import { SOLANA_CLUSTER } from '@ubc2026/contracts/solana';
import { accountValueLabel } from '../lib/account-value.mjs';
import { enrichPortfolio } from '../lib/dex-token.mjs';
import { previewPortfolioFor } from '../lib/dev-preview.mjs';
import { ownerAuthHeaders } from '../lib/owner-auth-headers.mjs';
import { rememberPortfolio } from '../lib/portfolio-cache.mjs';

export default function AccountValue({ ownerId, getAccessToken, wallets = [], devPreview = false, refreshKey = '' }) {
  const [portfolio, setPortfolio] = useState(null);
  const [pollTick, setPollTick] = useState(0);
  const walletKey = wallets.map(wallet => wallet?.address || '').filter(Boolean).sort().join(',');

  useEffect(() => {
    if (!ownerId) return undefined;
    const id = window.setInterval(() => setPollTick((tick) => tick + 1), 5000);
    return () => window.clearInterval(id);
  }, [ownerId]);

  useEffect(() => {
    setPortfolio(null);
    if (!ownerId) return undefined;
    const controller = new AbortController();
    let stopped = false;
    (async () => {
      try {
        let body;
        if (devPreview) {
          body = previewPortfolioFor(walletKey.split(',').filter(Boolean).map(address => ({ address })));
        } else {
          const response = await fetch(`/api/portfolio?cluster=${SOLANA_CLUSTER}`, {
            headers: await ownerAuthHeaders(ownerId, getAccessToken),
            cache: 'no-store',
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
          });
          if (!response.ok) return;
          body = await response.json();
        }
        const enriched = await enrichPortfolio(body, { userId: ownerId, storage: window.localStorage })
          .catch(() => ({ portfolio: body }));
        if (stopped) return;
        rememberPortfolio(ownerId, enriched.portfolio);
        setPortfolio(enriched.portfolio);
      } catch { /* An unavailable quote is not a zero-dollar balance. */ }
    })();
    return () => { stopped = true; controller.abort(); };
  }, [ownerId, getAccessToken, walletKey, devPreview, refreshKey, pollTick]);

  const partial = Number(portfolio?.unpriced) > 0;
  const title = !portfolio
    ? 'Account value unavailable'
    : `Total across connected Solana wallets${partial ? ' · Some assets have no price' : ''}`;
  return <span aria-label="Account value in USD" title={title}>{accountValueLabel(portfolio)}</span>;
}
