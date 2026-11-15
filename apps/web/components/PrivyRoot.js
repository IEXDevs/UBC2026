'use client';

import { useEffect } from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';
import { privyProviderProps } from '../lib/privy-config.mjs';
import {
  ensurePrivySessionKeys,
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
    // Re-assert after Privy mounts — a cold boot can race token writes, and
    // getAccessToken wipes the session if refresh is briefly missing.
    const timers = [0, 50, 200, 500].map((ms) => (
      window.setTimeout(() => {
        try {
          ensurePrivySessionKeys(window.localStorage, window.sessionStorage);
        } catch {
          /* ignore */
        }
      }, ms)
    ));
    const onFocus = () => {
      try {
        ensurePrivySessionKeys(window.localStorage, window.sessionStorage);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
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
