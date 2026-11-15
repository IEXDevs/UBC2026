'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';
import { privyProviderProps } from '../lib/privy-config.mjs';
import AcceptTermsGate from './AcceptTermsGate';

const props = privyProviderProps({
  appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
  clientId: process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID,
});

export default function PrivyRoot({ children }) {
  if (!props) return children;
  // Omit clientId unless set — a wrong App Client id makes login show
  // "Something went wrong" (often invalid_origin against that client's allowlist).
  const providerProps = {
    appId: props.appId,
    config: {
      ...props.config,
      externalWallets: {
        solana: { connectors: toSolanaWalletConnectors() },
      },
    },
  };
  if (props.clientId) providerProps.clientId = props.clientId;
  return (
    <PrivyProvider {...providerProps}>
      <AcceptTermsGate>{children}</AcceptTermsGate>
    </PrivyProvider>
  );
}
