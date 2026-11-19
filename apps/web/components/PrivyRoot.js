'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';
import {
  privyProviderProps,
  readSolanaConnectors,
  withSolanaExternalWallets,
} from '../lib/privy-config.mjs';
import { ToastProvider } from './bits/SwipeToast';

const PrivyPublicContext = createContext({
  configured: false,
  providerReady: false,
  appId: '',
  clientId: '',
});

const CONNECTOR_PENDING = Symbol('solana-connectors');

export function usePrivyPublic() {
  return useContext(PrivyPublicContext);
}

/**
 * Stock PrivyProvider. Session persistence is Privy's localStorage —
 * no Storage monkeypatches, backups, or restore loops.
 * App id and client id come from the server layout so the client bundle
 * and the prerender agree. A direct process.env read is empty in the browser.
 *
 * Solana connectors and PrivyProvider mount only after window exists.
 * Calling toSolanaWalletConnectors during SSR left an empty adapter list
 * ("No available adapters") after hydrate. An empty connectors array also
 * wipes Privy's defaults, so failed loads omit externalWallets instead.
 */
export default function PrivyRoot({ appId = '', clientId = '', children }) {
  const props = privyProviderProps({ appId, clientId });
  const [solanaConnectors, setSolanaConnectors] = useState(CONNECTOR_PENDING);
  useEffect(() => {
    let tries = 0;
    let timer = 0;
    function load() {
      const next = readSolanaConnectors(() => toSolanaWalletConnectors({ shouldAutoConnect: false }));
      if (next != null || tries >= 8) {
        setSolanaConnectors(next);
        return;
      }
      tries += 1;
      timer = window.setTimeout(load, 50);
    }
    load();
    return () => window.clearTimeout(timer);
  }, []);
  const browser = solanaConnectors !== CONNECTOR_PENDING;
  const value = {
    configured: props !== null,
    providerReady: props !== null && browser,
    appId: props?.appId || '',
    clientId: props?.clientId || '',
  };
  if (!props || !browser) {
    return (
      <PrivyPublicContext.Provider value={value}>
        <ToastProvider>{children}</ToastProvider>
      </PrivyPublicContext.Provider>
    );
  }

  // Omit clientId unless set — a wrong App Client id makes login show
  // "Something went wrong" (often invalid_origin against that client's allowlist).
  // Pin apiUrl so cookie-mode dashboards cannot rewrite sessions to /api/privy-auth.
  const providerProps = {
    appId: props.appId,
    apiUrl: props.apiUrl,
    config: withSolanaExternalWallets(props.config, solanaConnectors),
  };
  if (props.clientId) providerProps.clientId = props.clientId;

  return (
    <PrivyPublicContext.Provider value={value}>
      <ToastProvider>
        <PrivyProvider {...providerProps}>
          {children}
        </PrivyProvider>
      </ToastProvider>
    </PrivyPublicContext.Provider>
  );
}
