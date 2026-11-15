'use client';

import { useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useExportWallet } from '@privy-io/react-auth/solana';
import AddressCopy from './AddressCopy';
import {
  exportAddressForSheet,
  exportFailureNote,
  privyEmbeddedSolanaWallet,
} from '../lib/privy-export.mjs';

export default function PrivyKeyButton({ signedIn = false, address = '' }) {
  const { ready, authenticated, user } = usePrivy();
  const { exportWallet } = useExportWallet();
  const [note, setNote] = useState('');
  const embedded = privyEmbeddedSolanaWallet(user);
  const exportAddress = exportAddressForSheet(user, address);

  async function open() {
    setNote('');
    if (!ready || !authenticated) {
      setNote(exportFailureNote(new Error('not authenticated'), { hasEmbedded: Boolean(embedded) }));
      return;
    }
    if (!embedded) {
      setNote(exportFailureNote(null, { hasEmbedded: false }));
      return;
    }
    if (!exportAddress) {
      setNote(exportFailureNote(null, { hasEmbedded: true, addressMatch: false }));
      return;
    }
    try {
      await exportWallet({ address: exportAddress });
    } catch (error) {
      setNote(exportFailureNote(error, { hasEmbedded: true, addressMatch: true }));
    }
  }

  if (!signedIn) return <p className="quiet">Sign in to open the key in Privy.</p>;

  return (
    <div className="wallet-keys">
      <button type="button" className="wallet-export" onClick={open} disabled={!ready}>
        Open in Privy
      </button>
      {note ? <p className="quiet" role="status">{note}</p> : null}
      {!note && embedded && exportAddress ? (
        <p className="quiet">Opens Privy’s secure key screen for <AddressCopy address={exportAddress} />.</p>
      ) : null}
      {!note && embedded && !exportAddress ? (
        <p className="quiet">This sheet shows the agent wallet. Privy’s key screen only opens for your client embedded Solana wallet.</p>
      ) : null}
      {!note && !embedded ? (
        <p className="quiet">This login has no client embedded Solana wallet. The agent main wallet is created server-side, so this button cannot open a key screen for it.</p>
      ) : null}
    </div>
  );
}
