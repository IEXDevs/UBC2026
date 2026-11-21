'use client';

import { useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useExportWallet } from '@privy-io/react-auth/solana';
import AddressCopy from './AddressCopy';
import { copyText } from '../lib/copy-text.mjs';
import { readDeskGrant } from '../lib/desk-lock.mjs';
import { requestWalletExport } from '../lib/wallet-export-client.mjs';
import { createExportRecipient } from '../lib/wallet-hpke.mjs';
import {
  exportAddressForSheet,
  exportFailureNote,
  keyExportAction,
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
  const [revealed, setRevealed] = useState('');
  const embedded = privyEmbeddedSolanaWallet(user);
  const exportAddress = exportAddressForSheet(user, address);
  const action = keyExportAction({ walletId, embedded, sheetAddress: address });

  async function loadServerKey() {
    if (action.mode !== 'server') return { ok: false, error: 'not_exportable' };
    const grant = readDeskGrant(window.sessionStorage, ownerId, Date.now());
    if (!grant?.grant) return { ok: false, error: 'desk_lock_required' };
    const recipient = await createExportRecipient();
    const token = typeof getAccessToken === 'function' ? await getAccessToken() : '';
    const exported = await requestWalletExport(fetch, {
      ownerId,
      walletId: action.walletId,
      token,
      grant: grant.grant,
      recipientPublicKey: recipient.publicKey,
    });
    if (!exported.ok) return exported;
    const text = await recipient.open(exported.encapsulatedKey, exported.ciphertext);
    return { ok: true, text };
  }

  function lockNote(error) {
    if (error === 'desk_lock_required') return 'Unlock the wallet, then copy the key.';
    if (error === 'not_exportable' || error === 'observing_wallet') return 'This wallet cannot be exported.';
    if (error === 'wallet_not_found') return 'This wallet is not on the account.';
    if (error === 'signer_not_configured') return 'The signing service is not configured.';
    if (typeof error === 'string' && /^[a-z0-9_]{1,64}$/.test(error)) return `The key was not exported (${error}).`;
    return 'The key was not exported.';
  }

  async function copyServerKey() {
    setNote('');
    setRevealed('');
    try {
      const loaded = await loadServerKey();
      if (!loaded.ok) {
        setNote(lockNote(loaded.error));
        return;
      }
      setRevealed(loaded.text);
      const copied = await copyText(loaded.text);
      setNote(copied
        ? 'Copied. This browser does not keep the key after you leave this wallet.'
        : 'Select the key below and copy it. This browser does not keep it after you leave this wallet.');
    } catch {
      setNote('The key was not exported.');
    }
  }

  async function downloadAgentKey() {
    setNote('');
    try {
      const loaded = await loadServerKey();
      if (!loaded.ok) {
        setNote(loaded.error === 'desk_lock_required'
          ? 'Unlock the wallet, then download the key.'
          : lockNote(loaded.error));
        return;
      }
      downloadKey(loaded.text);
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

  if (!signedIn) return <p className="quiet">Sign in to copy the wallet key.</p>;

  return (
    <div className="wallet-keys">
      {action.mode === 'server' ? (
        <button type="button" className="wallet-export" onClick={copyServerKey}>
          Copy private key
        </button>
      ) : (
        <button type="button" className="wallet-export" onClick={open} disabled={!ready}>
          Open in Privy
        </button>
      )}
      {action.mode === 'server' ? (
        <button type="button" className="wallet-export" onClick={downloadAgentKey}>
          Download key
        </button>
      ) : null}
      {revealed ? (
        <div className="wallet-key-reveal">
          <textarea readOnly value={revealed} aria-label="Private key" spellCheck={false} />
          <button type="button" className="wallet-export" onClick={() => setRevealed('')}>
            Hide key
          </button>
        </div>
      ) : null}
      {note ? <p className="quiet" role="status">{note}</p> : null}
      {!note && action.mode === 'server' ? (
        <p className="quiet">Copies this wallet’s private key. Unlock the wallet first. The key is not stored here.</p>
      ) : null}
      {!note && action.mode === 'client' && exportAddress ? (
        <p className="quiet">Opens Privy’s secure key screen for <AddressCopy address={exportAddress} />.</p>
      ) : null}
      {!note && action.mode === 'client' && !exportAddress ? (
        <p className="quiet">This sheet shows the agent wallet. Privy’s key screen only opens for your client embedded Solana wallet.</p>
      ) : null}
      {!note && action.mode === 'none' ? (
        <p className="quiet">This login has no client embedded Solana wallet, and this address is not an exportable server wallet.</p>
      ) : null}
    </div>
  );
}
