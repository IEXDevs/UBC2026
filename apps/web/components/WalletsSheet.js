'use client';

import { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useExportWallet } from '@privy-io/react-auth/solana';
import { X } from 'lucide-react';
import BotHistory from './BotHistory';
import { usePresence } from './usePresence';
import { partyFromToken } from '../lib/party-book.mjs';
import { describeWallets, shortAddress, walletGlance } from '../lib/money-views.mjs';
import {
  exportAddressForSheet,
  exportFailureNote,
  privyEmbeddedSolanaWallet,
} from '../lib/privy-export.mjs';
import TxnLog from './TxnLog';

const PANES = [
  { id: 'balance', label: 'Balance' },
  { id: 'history', label: 'History' },
  { id: 'keys', label: 'Private Keys' },
];

export default function WalletsSheet({ open, onClose, state, note = '', transfers = [], bot = null, onParty, signedIn = false }) {
  const { mounted, leaving } = usePresence(open);
  const [pane, setPane] = useState('balance');

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) setPane('balance');
  }, [open]);

  if (!mounted) return null;

  const wallets = state?.wallets || [];
  const bots = state?.bots || [];
  const glance = walletGlance(wallets, state?.positions || [], transfers);
  const rows = describeWallets(wallets, bots);

  return (
    <div className={`backdrop is-center ${leaving ? 'is-leaving' : ''}`} onMouseDown={onClose}>
      <section
        className="sheet wallets-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallets-title"
        onMouseDown={event => event.stopPropagation()}
      >
        <nav className="wallet-nav" aria-label="Wallet sections">
          <strong id="wallets-title">Wallet</strong>
          {PANES.map(item => (
            <button
              key={item.id}
              type="button"
              className={pane === item.id ? 'is-on' : ''}
              aria-current={pane === item.id ? 'page' : undefined}
              onClick={() => setPane(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="wallet-body">
          <div className="sheet-head">
            <h2>{PANES.find(item => item.id === pane)?.label}</h2>
            <button type="button" className="icon-btn" aria-label="Close wallets" onClick={onClose}>
              <X size={18} strokeWidth={1.75} />
            </button>
          </div>
          {note && pane === 'balance' ? <p className="preview-note">{note}</p> : null}
          {pane === 'balance' ? <Balance glance={glance} rows={rows} /> : null}
          {pane === 'history' ? (
            bot ? (
              <BotHistory bot={bot} bots={bots} payments={state?.payments || []} transfers={transfers} onParty={onParty} />
            ) : (
              <TxnLog
                rows={transfers.map(row => {
                  const direction = row.direction === 'in' ? 'in' : 'out';
                  return {
                    id: row.id,
                    direction,
                    title: `${direction === 'in' ? 'From' : 'To'} @${row.handle}`,
                    detail: 'Platform',
                    amount: row.amount,
                    asset: 'USDC',
                    party: partyFromToken(`@${row.handle}`),
                  };
                })}
                onParty={onParty}
                empty="No history yet."
              />
            )
          ) : null}
          {pane === 'keys' ? <KeyPane signedIn={signedIn} address={glance.address} /> : null}
        </div>
      </section>
    </div>
  );
}

function Balance({ glance, rows }) {
  return (
    <div className="wallet-balance">
      <p className="wallet-figure">{glance.balanceLabel}</p>
      <p className="preview-note">{glance.platform ? 'Includes platform transfers. Chain execution stays on devnet.' : 'Paper balance from positions. Chain execution stays on devnet.'}</p>
      {rows.length === 0 ? <p className="preview-note">No wallet yet.</p> : (
        <ul className="wallet-list">
          {rows.map(row => (
            <li key={row.id}>
              <strong>{row.label}</strong>
              <span>{shortAddress(row.address) || 'No address'}</span>
              <small>{row.frozen ? 'Frozen' : row.kind}{row.bots.length ? ` · ${row.bots.join(', ')}` : ''}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function KeyPane({ signedIn, address }) {
  return (
    <div className="wallet-keys">
      <p>The private key stays in Privy. This screen never reads it, stores it, or shows it.</p>
      {signedIn ? <SolanaKeyExport address={address} /> : <p className="preview-note">Sign in to open the key in Privy.</p>}
    </div>
  );
}

function SolanaKeyExport({ address }) {
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

  return (
    <>
      <button type="button" className="wallet-export" onClick={open} disabled={!ready}>
        Open in Privy
      </button>
      {note ? <p className="preview-note" role="status">{note}</p> : null}
      {!note && embedded && exportAddress ? (
        <p className="preview-note">Opens Privy’s secure key screen for {shortAddress(exportAddress)}.</p>
      ) : null}
      {!note && embedded && !exportAddress ? (
        <p className="preview-note">
          This sheet shows the agent wallet. Privy’s key screen only opens for your client embedded Solana wallet.
        </p>
      ) : null}
      {!note && !embedded ? (
        <p className="preview-note">
          This login has no client embedded Solana wallet. The agent main wallet is created server-side, so this button cannot open a key screen for it.
        </p>
      ) : null}
    </>
  );
}
