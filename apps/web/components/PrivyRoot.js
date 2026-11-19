'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';
import { privyProviderProps } from '../lib/privy-config.mjs';
import { ToastProvider } from './bits/SwipeToast';

const PrivyPublicContext = createContext({
  configured: false,
  providerReady: false,
  appId: '',
  clientId: '',
});

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
 * ("No available adapters") after hydrate.
 */
export default function PrivyRoot({ appId = '', clientId = '', children }) {
  const props = privyProviderProps({ appId, clientId });
  const [browser, setBrowser] = useState(false);
  useEffect(() => {
    setBrowser(true);
  }, []);
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
  let solanaConnectors = [];
  try {
    solanaConnectors = toSolanaWalletConnectors({ shouldAutoConnect: false }) || [];
  } catch {
    solanaConnectors = [];
  }
  const providerProps = {
    appId: props.appId,
    apiUrl: props.apiUrl,
    config: {
      ...props.config,
      externalWallets: {
        solana: { connectors: solanaConnectors },
      },
    },
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
