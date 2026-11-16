'use client';

import { useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useExportWallet } from '@privy-io/react-auth/solana';
import AddressCopy from './AddressCopy';
import { readDeskGrant } from '../lib/desk-lock.mjs';
import { requestWalletExport } from '../lib/wallet-export-client.mjs';
import { createExportRecipient } from '../lib/wallet-hpke.mjs';
import {
  exportAddressForSheet,
  exportFailureNote,
  privyEmbeddedSolanaWallet,
} from '../lib/privy-export.mjs';

function downloadKey(text) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'maelstrom-wallet-key.txt';
  link.click();
  URL.revokeObjectURL(url);
}

export default function PrivyKeyButton({
  signedIn = false,
  address = '',
  walletId = '',
  ownerId = '',
  getAccessToken,
}) {
  const { ready, authenticated, user } = usePrivy();
  const { exportWallet } = useExportWallet();
  const [note, setNote] = useState('');
  const embedded = privyEmbeddedSolanaWallet(user);
  const exportAddress = exportAddressForSheet(user, address);

  async function downloadAgentKey() {
    setNote('');
    const grant = readDeskGrant(window.sessionStorage, ownerId, Date.now());
    if (!grant?.grant) {
      setNote('Unlock the desk, then download the key.');
      return;
    }
    if (!walletId) {
      setNote('This wallet cannot be exported.');
      return;
    }
    try {
      const recipient = await createExportRecipient();
      const token = typeof getAccessToken === 'function' ? await getAccessToken() : '';
      const exported = await requestWalletExport(fetch, {
        ownerId,
        walletId,
        token,
        grant: grant.grant,
        recipientPublicKey: recipient.publicKey,
      });
      if (!exported.ok) {
        setNote(exported.error === 'desk_lock_required'
          ? 'Unlock the desk, then download the key.'
          : 'The key was not exported.');
        return;
      }
      const text = await recipient.open(exported.encapsulatedKey, exported.ciphertext);
      downloadKey(text);
      setNote('Downloaded. This browser does not keep the key.');
    } catch {
      setNote('The key was not exported.');
    }
  }

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
      {walletId ? (
        <button type="button" className="wallet-export" onClick={downloadAgentKey}>
          Download key
        </button>
      ) : null}
      {note ? <p className="quiet" role="status">{note}</p> : null}
      {!note && embedded && exportAddress ? (
        <p className="quiet">Opens Privy’s secure key screen for <AddressCopy address={exportAddress} />.</p>
      ) : null}
      {!note && embedded && !exportAddress ? (
        <p className="quiet">This sheet shows the agent wallet. Privy’s key screen only opens for your client embedded Solana wallet.</p>
      ) : null}
      {!note && !embedded && walletId ? (
        <p className="quiet">Download key exports this server wallet. Unlock the desk first. The file is not stored here.</p>
      ) : null}
      {!note && !embedded && !walletId ? (
        <p className="quiet">This login has no client embedded Solana wallet, and this address is not an exportable server wallet.</p>
      ) : null}
    </div>
  );
}
