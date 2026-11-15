'use client';

import { useEffect, useState } from 'react';
import { useExportWallet } from '@privy-io/react-auth/solana';
import { X } from 'lucide-react';
import BotHistory from './BotHistory';
import { usePresence } from './usePresence';
import { partyFromToken } from '../lib/party-book.mjs';
import { describeWallets, shortAddress, walletGlance } from '../lib/money-views.mjs';
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
  const { exportWallet } = useExportWallet();
  const [note, setNote] = useState('');

  async function open() {
    setNote('');
    try {
      await exportWallet(address ? { address } : undefined);
    } catch {
      setNote('Privy did not open the key screen.');
    }
  }

  return (
    <>
      <button type="button" className="wallet-export" onClick={open}>Open in Privy</button>
      {note ? <p className="preview-note" role="status">{note}</p> : null}
    </>
  );
}
