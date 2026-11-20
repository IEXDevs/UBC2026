'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSignTransaction, useWallets } from '@privy-io/react-auth/solana';
import { SOLANA_CLUSTER, SOLANA_PRIVY_CHAIN, SOLANA_USDC_MINT } from '@ubc2026/contracts/solana';
import { swapFailure } from '../lib/swap-failure.mjs';
import {
  JUPITER_STATUS_NOTE,
  jupiterSwapStatus,
  loadJupiterPlugin,
  passthroughWallet,
  swapPair,
} from '../lib/jupiter-plugin.mjs';

export default function JupiterSwap({ address = '', label = '', frozen = false, inputMint = '', onSwapped }) {
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const signer = (Array.isArray(wallets) ? wallets : []).find(wallet => wallet?.address === address) || null;
  const status = jupiterSwapStatus({
    cluster: SOLANA_CLUSTER,
    address,
    frozen,
    canSign: Boolean(signer && typeof signTransaction === 'function'),
  });
  const embed = status !== 'not_mainnet' && status !== 'no_wallet';
  const targetId = `jupiter-swap-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  const [phase, setPhase] = useState('loading');
  const [result, setResult] = useState('');
  const signingFailure = useRef('');
  const context = useMemo(() => passthroughWallet({
    address,
    name: label || 'Maelstrom wallet',
    signBytes: status === 'ready'
      ? async (transaction) => {
        signingFailure.current = '';
        setResult('');
        try {
          const signed = await signTransaction({ transaction, wallet: signer, chain: SOLANA_PRIVY_CHAIN });
          if (!signed?.signedTransaction) throw new Error('empty_signature');
          return signed.signedTransaction;
        } catch (error) {
          signingFailure.current = swapFailure({ code: error?.code === 4001 ? 'wallet_rejected' : 'privy_failed' }).message;
          setResult(signingFailure.current);
          throw error;
        }
      }
      : null,
  }), [address, label, status, signer, signTransaction]);
  const contextRef = useRef(context);
  const swappedRef = useRef(onSwapped);
  contextRef.current = context;
  swappedRef.current = onSwapped;

  useEffect(() => {
    if (!embed) return undefined;
    let stop = false;
    setPhase('loading');
    loadJupiterPlugin()
      .then((jupiter) => {
        if (stop || !document.getElementById(targetId)) return;
        jupiter.init({
          displayMode: 'integrated',
          integratedTargetId: targetId,
          localStoragePrefix: 'maelstrom-jupiter',
          defaultExplorer: 'Solscan',
          containerStyles: { width: '100%', height: '100%' },
          formProps: swapPair(inputMint, SOLANA_USDC_MINT),
          enableWalletPassthrough: true,
          passthroughWalletContextState: contextRef.current,
          onRequestConnectWallet: () => setResult(JUPITER_STATUS_NOTE.no_signer),
          onSuccess: ({ txid }) => {
            setResult('Swap confirmed.');
            swappedRef.current?.(txid);
          },
          onSwapError: (error) => {
            const failure = swapFailure({ code: error?.code || error?.error?.code });
            setResult(signingFailure.current || (failure.code === 'swap_failed'
              ? swapFailure({ code: 'plugin_swap_failed' }).message : failure.message));
          },
        });
        setPhase('ready');
      })
      .catch(() => {
        if (!stop) {
          setPhase('failed');
          setResult(swapFailure({ code: 'plugin_load_failed' }).message);
        }
      });
    return () => {
      stop = true;
      try { window.Jupiter?.root?.unmount?.(); } catch { /* the plugin root is already gone */ }
    };
  }, [embed, targetId, inputMint]);

  useEffect(() => {
    if (phase === 'ready') window.Jupiter?.syncProps?.({ passthroughWalletContextState: context });
  }, [context, phase]);

  return (
    <div className="jupiter-swap">
      <p className="quiet">{status === 'ready' ? JUPITER_STATUS_NOTE[status] : `Swap — wallet: ${JUPITER_STATUS_NOTE[status]} [${status}]`}</p>
      {embed ? (
        <div className="jupiter-swap-frame" aria-busy={phase === 'loading'}>
          <div id={targetId} className="jupiter-swap-target" />
          {phase === 'loading' ? <p className="quiet jupiter-swap-hold">Loading Jupiter…</p> : null}
          {phase === 'failed' ? <p className="quiet jupiter-swap-hold">{swapFailure({ code: 'plugin_load_failed' }).message}</p> : null}
        </div>
      ) : null}
      {result ? <p className="quiet" role="status">{result}</p> : null}
    </div>
  );
}
