'use client';

import { useEffect } from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';
import { privyProviderProps } from '../lib/privy-config.mjs';
import {
  installPrivySessionMirror,
  restorePrivySessionIfMissing,
} from '../lib/privy-session.mjs';
import { ToastProvider } from './bits/SwipeToast';
import AcceptTermsGate from './AcceptTermsGate';

const props = privyProviderProps({
  appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
  clientId: process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID,
});

function bootPrivySession() {
  if (typeof window === 'undefined') return;
  try {
    // One cold-boot restore only. Re-asserting after Privy rejects a session
    // left tokens in storage while authenticated stayed false.
    restorePrivySessionIfMissing(window.localStorage, window.sessionStorage);
    installPrivySessionMirror(window);
  } catch {
    /* private mode — Privy still owns its own storage */
  }
}

bootPrivySession();

export default function PrivyRoot({ children }) {
  useEffect(() => {
    bootPrivySession();
  }, []);

  if (!props) return <ToastProvider>{children}</ToastProvider>;
  // Omit clientId unless set — a wrong App Client id makes login show
  // "Something went wrong" (often invalid_origin against that client's allowlist).
  const providerProps = {
    appId: props.appId,
    config: {
      ...props.config,
      externalWallets: {
        solana: { connectors: toSolanaWalletConnectors({ shouldAutoConnect: false }) },
      },
    },
  };
  if (props.clientId) providerProps.clientId = props.clientId;
  return (
    <ToastProvider>
      <PrivyProvider {...providerProps}>
        <AcceptTermsGate>{children}</AcceptTermsGate>
      </PrivyProvider>
    </ToastProvider>
  );
}
