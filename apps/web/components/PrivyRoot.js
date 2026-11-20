'use client';

import { createContext, useContext, useEffect } from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';
import { SOLANA_PRIVY_CHAIN, SOLANA_RPC_URL } from '@ubc2026/contracts/solana';
import { privyProviderProps } from '../lib/privy-config.mjs';
import { installSiwsLoginDiagnostic } from '../lib/siws-login-diagnostic.mjs';
import { ToastProvider } from './bits/SwipeToast';

const PrivyPublicContext = createContext({ configured: false, appId: '', clientId: '' });

export function usePrivyPublic() {
  return useContext(PrivyPublicContext);
}

/**
 * Stock PrivyProvider. Session persistence is Privy's localStorage —
 * no Storage monkeypatches, backups, or restore loops.
 * App id and client id come from the server layout so the client bundle
 * and the prerender agree. A direct process.env read is empty in the browser.
 */
export default function PrivyRoot({ appId = '', clientId = '', children }) {
  const props = privyProviderProps({ appId, clientId });
  const value = {
    configured: props !== null,
    appId: props?.appId || '',
    clientId: props?.clientId || '',
  };
  // Privy keeps SIWS failures inside its modal. Record status and a safe code only.
  useEffect(() => {
    if (!value.appId) return undefined;
    installSiwsLoginDiagnostic();
  }, [value.appId]);
  if (!props) {
    return (
      <PrivyPublicContext.Provider value={value}>
        <ToastProvider>{children}</ToastProvider>
      </PrivyPublicContext.Provider>
    );
  }

  // Omit clientId unless set — a wrong App Client id makes login show
  // "Something went wrong" (often invalid_origin against that client's allowlist).
  const providerProps = {
    appId: props.appId,
    config: {
      ...props.config,
      solana: {
        rpcs: {
          [SOLANA_PRIVY_CHAIN]: {
            rpc: createSolanaRpc(SOLANA_RPC_URL),
            rpcSubscriptions: createSolanaRpcSubscriptions(SOLANA_RPC_URL.replace('https:', 'wss:')),
          },
        },
      },
      externalWallets: {
        solana: { connectors: toSolanaWalletConnectors({ shouldAutoConnect: false }) },
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
