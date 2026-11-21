'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowUpDown, ChevronDown } from 'lucide-react';
import { usePrivy } from '@privy-io/react-auth';
import { useSignTransaction, useWallets, useStandardWallets } from '@privy-io/react-auth/solana';
import { SOLANA_CLUSTER, SOLANA_USDC_MINT } from '@ubc2026/contracts/solana';
import { swapFailure } from '../lib/swap-failure.mjs';
import { signSelectedWalletTransaction, withLinkedSolanaWallets } from '../lib/wallet-signing.mjs';
import {
  JUPITER_STATUS_NOTE,
  jupiterSwapStatus,
  loadJupiterPlugin,
  passthroughWallet,
  swapPair,
} from '../lib/jupiter-plugin.mjs';
import { TokenIcon, VerifiedBadge } from './PhantomIcons';

export default function JupiterSwap({ address = '', label = '', frozen = false, inputMint = '', onSwapped }) {
  const { wallets } = useWallets();
  const { wallets: standardWallets } = useStandardWallets();
  const { user } = usePrivy();
  const { signTransaction } = useSignTransaction();
  const linkedWallets = useMemo(() => withLinkedSolanaWallets(wallets, standardWallets, user), [wallets, standardWallets, user]);
  const signer = linkedWallets.find(wallet => wallet?.address === address) || null;
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
          return await signSelectedWalletTransaction({ from: { address, frozen }, transaction,
            signer: { wallets: [signer], signTransaction }, forSwap: true });
        } catch (error) {
          signingFailure.current = swapFailure({ code: error?.code, signingHttpStatus: error?.signingHttpStatus }).message;
          setResult(signingFailure.current);
          throw error;
        }
      }
      : null,
  }), [address, label, frozen, status, signer, signTransaction]);
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
    <div className="jupiter-swap phantom-swap-wrap">
      <p className="quiet phantom-swap-note">{status === 'ready' ? JUPITER_STATUS_NOTE[status] : `Swap — wallet: ${JUPITER_STATUS_NOTE[status]} [${status}]`}</p>
      {embed ? (
        <div className="jupiter-swap-frame phantom-swap-frame" aria-busy={phase === 'loading'}>
          <div id={targetId} className="jupiter-swap-target" />
          {phase === 'loading' ? (
            <div className="phantom-swap-skeleton">
              {/* "You Pay" Card (Screenshot 3) */}
              <div className="phantom-swap-card">
                <div className="phantom-swap-card-head">
                  <span className="phantom-swap-label">You Pay</span>
                </div>
                <div className="phantom-swap-card-body">
                  <span className="phantom-swap-number">0</span>
                  <div className="phantom-swap-pill">
                    <TokenIcon symbol="SOL" size={26} showSolanaBadge={false} />
                    <strong>SOL</strong>
                    <VerifiedBadge size={14} />
                    <ChevronDown size={14} />
                  </div>
                </div>
                <div className="phantom-swap-card-foot">
                  <span className="phantom-swap-bal">0.04</span>
                  <div className="phantom-swap-quick">
                    <span className="phantom-quick-pill">50%</span>
                    <span className="phantom-quick-pill">100%</span>
                  </div>
                </div>
              </div>

              {/* Flip Button in between (Screenshot 3) */}
              <div className="phantom-swap-flip-wrap">
                <span className="phantom-swap-flip-btn">
                  <ArrowUpDown size={18} strokeWidth={2.4} />
                </span>
              </div>

              {/* "You Receive" Card (Screenshot 3) */}
              <div className="phantom-swap-card">
                <div className="phantom-swap-card-head">
                  <span className="phantom-swap-label">You Receive</span>
                </div>
                <div className="phantom-swap-card-body">
                  <span className="phantom-swap-number">0</span>
                  <div className="phantom-swap-pill">
                    <TokenIcon symbol="USDC" size={26} showSolanaBadge={true} />
                    <strong>USDC</strong>
                    <VerifiedBadge size={14} />
                    <ChevronDown size={14} />
                  </div>
                </div>
                <div className="phantom-swap-card-foot">
                  <span className="phantom-swap-bal">88</span>
                </div>
              </div>

              <p className="quiet jupiter-swap-hold phantom-swap-loading-msg">Connecting to Jupiter…</p>
            </div>
          ) : null}
          {phase === 'failed' ? <p className="quiet jupiter-swap-hold">{swapFailure({ code: 'plugin_load_failed' }).message}</p> : null}
        </div>
      ) : null}
      {result ? <p className="quiet" role="status">{result}</p> : null}
    </div>
  );
}
