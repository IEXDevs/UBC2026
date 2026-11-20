'use client';

import { useState } from 'react';
import { useLinkAccount, usePrivy, useUnlinkWallet } from '@privy-io/react-auth';
import { Plus, ShieldCheck, Unlink, Wallet } from 'lucide-react';
import AddressCopy from './AddressCopy';
import { manageableWallets } from '../lib/wallet-management.mjs';

export default function ConnectedWallets({ wallets = [], showAdd = true }) {
  const { user, ready, authenticated } = usePrivy();
  const { unlink: unlinkWallet } = useUnlinkWallet();
  const [pending, setPending] = useState('');
  const [removing, setRemoving] = useState('');
  const [removed, setRemoved] = useState([]);
  const [note, setNote] = useState('');
  const { linkWallet } = useLinkAccount({ onError: () => setNote('Could not link this wallet. Try again.') });
  const rows = manageableWallets(wallets, user).filter(wallet => !removed.includes(wallet.address));
  const enabled = ready && authenticated;

  async function unlink(wallet) {
    if (!enabled || !wallet.canUnlink || removing) return;
    setRemoving(wallet.address);
    setNote('');
    try {
      await unlinkWallet({ address: wallet.address });
      setRemoved(current => [...current, wallet.address]);
      setPending('');
      setNote(`${wallet.label} unlinked.`);
    } catch {
      setNote('Could not unlink this wallet. Keep another sign-in method linked and try again.');
    } finally { setRemoving(''); }
  }

  return (
    <section className="connected-wallets" aria-label="Connected wallets">
      <div className="settings-section-head">
        <div><h3>Connected wallets</h3><p className="quiet">Your agent wallet and linked Solana accounts.</p></div>
        {showAdd ? <button type="button" className="ghost wallet-add" disabled={!enabled || Boolean(removing)} onClick={() => {
          setNote('');
          setRemoved([]);
          try { linkWallet({ walletChainType: 'solana-only' }); }
          catch { setNote('Could not open wallet linking. Try again.'); }
        }}><Plus size={15} />Add wallet</button> : null}
      </div>
      {rows.length ? <ul className="connected-wallet-list">
        {rows.map(wallet => (
          <li key={wallet.address}>
            <div className="connected-wallet-row">
              <span className="settings-icon">{wallet.external ? <Wallet size={19} /> : <ShieldCheck size={19} />}</span>
              <div className="connected-wallet-info"><strong>{wallet.label}</strong><span>{wallet.external ? 'External · Read-only' : 'Managed by Privy'}</span><AddressCopy address={wallet.address} /></div>
              {wallet.canUnlink ? <button type="button" className="wallet-unlink" disabled={!enabled || Boolean(removing)} aria-label={`Unlink ${wallet.label}`} onClick={() => setPending(wallet.address)}><Unlink size={14} />{removing === wallet.address ? 'Unlinking…' : 'Unlink'}</button> : <span className="wallet-type">Agent</span>}
            </div>
            {pending === wallet.address ? <div className="wallet-unlink-confirm"><p>Unlink {wallet.label}? Your funds stay in the wallet. This also removes it as a sign-in method.</p><div><button type="button" className="ghost" disabled={Boolean(removing)} onClick={() => setPending('')}>Cancel</button><button type="button" className="ghost" disabled={Boolean(removing)} onClick={() => unlink(wallet)}>{removing ? 'Unlinking…' : 'Confirm unlink'}</button></div></div> : null}
          </li>
        ))}
      </ul> : <div className="wallet-empty"><Wallet size={22} /><p>No wallets connected yet.</p><span>Add a Solana wallet to view it here.</span></div>}
      {note ? <p className="quiet" role="status">{note}</p> : null}
    </section>
  );
}
