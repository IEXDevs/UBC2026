'use client';

import { useEffect, useRef, useState } from 'react';
import { SOLANA_CLUSTER } from '@ubc2026/contracts/solana';
import { accountValueLabel, hasAccountValue } from '../lib/account-value.mjs';
import { enrichPortfolio } from '../lib/dex-token.mjs';
import { previewPortfolioFor } from '../lib/dev-preview.mjs';
import { ownerAuthHeaders } from '../lib/owner-auth-headers.mjs';
import { rememberPortfolio } from '../lib/portfolio-cache.mjs';

export default function AccountValue({ ownerId, getAccessToken, wallets = [], devPreview = false, refreshKey = '' }) {
  const [portfolio, setPortfolio] = useState(null);
  const refreshPortfolio = useRef(null);
  const walletKey = wallets.map(wallet => wallet?.address || '').filter(Boolean).sort().join(',');

  useEffect(() => {
    if (!ownerId) return undefined;
    const controller = new AbortController();
    let pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
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
        if (controller.signal.aborted) return;
        rememberPortfolio(ownerId, enriched.portfolio);
        if (hasAccountValue(enriched.portfolio)) setPortfolio(enriched.portfolio);
      } catch { /* An unavailable quote is not a zero-dollar balance. */ }
      finally { pending = false; }
    };
    refreshPortfolio.current = load;
    void load();
    return () => {
      refreshPortfolio.current = null;
      controller.abort();
    };
  }, [ownerId, getAccessToken, walletKey, devPreview]);

  useEffect(() => {
    void refreshPortfolio.current?.();
  }, [refreshKey]);

  const partial = Number(portfolio?.unpriced) > 0;
  const title = !portfolio
    ? 'Account value unavailable'
    : `Total across connected Solana wallets${partial ? ' · Some assets have no price' : ''}`;
  return <span aria-label="Account value in USD" title={title}>{accountValueLabel(portfolio)}</span>;
}
