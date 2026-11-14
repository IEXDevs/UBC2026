'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';
import { privyProviderProps } from '../lib/privy-config.mjs';

const props = privyProviderProps({
  appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
  clientId: process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID,
});

export default function PrivyRoot({ children }) {
  if (!props) return children;
  return (
    <PrivyProvider
      appId={props.appId}
      clientId={props.clientId}
      config={{
        ...props.config,
        externalWallets: {
          solana: { connectors: toSolanaWalletConnectors() },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
