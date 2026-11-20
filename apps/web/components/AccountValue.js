'use client';

import { useEffect, useState } from 'react';
import { accountValueLabel } from '../lib/account-value.mjs';
import { enrichPortfolio } from '../lib/dex-token.mjs';
import { previewPortfolioFor } from '../lib/dev-preview.mjs';
import { ownerAuthHeaders } from '../lib/owner-auth-headers.mjs';
import { rememberPortfolio } from '../lib/portfolio-cache.mjs';

export default function AccountValue({ ownerId, getAccessToken, wallets = [], devPreview = false, refreshKey = '' }) {
  const [portfolio, setPortfolio] = useState(null);
  const walletKey = wallets.map(wallet => wallet?.address || '').filter(Boolean).sort().join(',');

  useEffect(() => {
    setPortfolio(null);
    if (!ownerId) return undefined;
    if (devPreview) {
      setPortfolio(previewPortfolioFor(walletKey.split(',').filter(Boolean).map(address => ({ address }))));
      return undefined;
    }
    const controller = new AbortController();
    let stopped = false;
    (async () => {
      try {
        const response = await fetch('/api/portfolio?cluster=devnet', {
          headers: await ownerAuthHeaders(ownerId, getAccessToken),
          cache: 'no-store',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        });
        if (!response.ok) return;
        const body = await response.json();
        const enriched = await enrichPortfolio(body, { userId: ownerId, storage: window.localStorage })
          .catch(() => ({ portfolio: body }));
        if (stopped) return;
        rememberPortfolio(ownerId, enriched.portfolio);
        setPortfolio(enriched.portfolio);
      } catch { /* An unavailable quote is not a zero-dollar balance. */ }
    })();
    return () => { stopped = true; controller.abort(); };
  }, [ownerId, getAccessToken, walletKey, devPreview, refreshKey]);

  const partial = Number(portfolio?.unpriced) > 0;
  const title = !portfolio
    ? 'Account value unavailable'
    : `Total across connected Solana wallets · devnet execution, mainnet pricing${partial ? ' · Some assets have no price' : ''}`;
  return <span aria-label="Account value in USD" title={title}>{accountValueLabel(portfolio)}</span>;
}
