'use client';

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import {
  describeHistory,
  describeWallets,
  SOLSCAN_DEVNET,
} from '../lib/money-views.mjs';
import AnimatedList from './AnimatedList';
import PositionBook from './PositionBook';
import { listLook } from './listLook';

export default function MoneyPane({ pane, state, signedIn = false, onSignIn = null, note = '' }) {
  if (pane === 'history') return <History state={state} signedIn={signedIn} onSignIn={onSignIn} note={note} />;
  if (pane === 'wallets') return <Wallets state={state} signedIn={signedIn} onSignIn={onSignIn} note={note} />;
  return <Positions state={state} signedIn={signedIn} onSignIn={onSignIn} />;
}

function SignedOutNote({ onSignIn }) {
  return (
    <section className="panel" aria-label="Signed out">
      <h2>Sign in required</h2>
      <p className="preview-note">Connect to load your own wallets, payments, and positions. This pane stays empty while you are signed out.</p>
      {onSignIn ? <button type="button" className="solid" onClick={onSignIn}>Connect</button> : null}
    </section>
  );
}

function History({ state, signedIn, onSignIn, note }) {
  if (!signedIn) return <SignedOutNote onSignIn={onSignIn} />;
  const rows = describeHistory(state.payments || [], state.bots || []);
  const [openId, setOpenId] = useState(null);
  return (
    <section className="panel" aria-label="History">
      <h2>History</h2>
      {note ? <p className="preview-note">{note}</p> : null}
      {rows.length === 0 ? <p className="preview-note">No payments yet for your bots.</p> : (
        <>
          <AnimatedList
            {...listLook()}
            items={rows.map(row => ({
              id: row.id,
              title: row.counterparty,
              description: `${row.botName} · ${row.protocol} · ${row.cluster}`,
              meta: row.signedFigure,
            }))}
            onItemSelect={item => setOpenId(current => current === item.id ? null : item.id)}
          />
          {rows.filter(row => row.id === openId).map(row => (
            <HistoryDetail key={row.id} row={row} />
          ))}
        </>
      )}
    </section>
  );
}

function HistoryDetail({ row }) {
  const inflow = row.flow === 'in';
  return (
    <dl className="ledger-detail" id={`payment-${row.id}`}>
      <Detail label="Direction" value={inflow ? 'Earned' : 'Paid'} />
      <Detail label="Where" value={row.counterparty} />
      <Detail label="Agent" value={row.botName} />
      <Detail label="Protocol" value={row.protocol} />
      <Detail label="Cluster" value={row.cluster} />
      <Detail label="Amount" value={row.amountLabel} />
      <Detail label="Base units" value={`${row.baseUnits} ${row.asset}`} />
      <Detail label="Payment" value={row.id} />
      <Detail label="Signature" value={row.txSignature ?? 'Not broadcast yet'} />
      <div className="ledger-meta ledger-meta-link">
        <dt>Explorer</dt>
        <dd>
          <a href={row.solscanUrl ?? SOLSCAN_DEVNET} target="_blank" rel="noreferrer">
            {row.solscanUrl ? 'View transaction' : 'Open devnet explorer'}
            <ExternalLink size={14} strokeWidth={1.75} />
          </a>
        </dd>
      </div>
    </dl>
  );
}

function Detail({ label, value }) {
  return (
    <div className="ledger-meta">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Wallets({ state, signedIn, onSignIn, note }) {
  if (!signedIn) return <SignedOutNote onSignIn={onSignIn} />;
  const rows = describeWallets(state.wallets || [], state.bots || []);
  return (
    <section className="panel" aria-label="Wallets">
      <h2>Wallets</h2>
      {note ? <p className="preview-note">{note}</p> : null}
      {rows.length === 0 ? (
        <p className="preview-note">
          No Solana wallets in the shell yet. Confirm root <code>.env.local</code> has
          {' '}<code>PRIVY_APP_SECRET</code> (and usually <code>PRIVY_AUTHORIZATION_KEY</code>),
          restart Next, then sign out and back in. Wallets that only exist as Ethereum in the
          Privy dashboard will not appear here.
        </p>
      ) : (
        <AnimatedList
          {...listLook()}
          items={rows.map(row => ({
            id: row.id,
            title: row.label,
            description: `${row.address} · ${row.bots.length ? row.bots.join(', ') : 'No agents assigned'}`,
            meta: row.frozen ? 'Frozen' : row.kind,
          }))}
        />
      )}
    </section>
  );
}

function Positions({ state, signedIn, onSignIn }) {
  if (!signedIn) return <SignedOutNote onSignIn={onSignIn} />;
  const positions = state.positions || [];
  if (positions.length === 0) {
    return (
      <section className="panel" aria-label="Positions">
        <h2>Positions</h2>
        <p className="preview-note">No live positions yet. Paper lots and Worker position reads will show here when bots open them.</p>
      </section>
    );
  }
  return <PositionBook positions={positions} bots={state.bots || []} wallets={state.wallets || []} />;
}
