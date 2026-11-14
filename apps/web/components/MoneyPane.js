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

const PREVIEW = 'Preview rows. Live payments, wallets, and positions stay empty until the Worker API leaves stub status.';

export default function MoneyPane({ pane, state }) {
  if (pane === 'history') return <History state={state} />;
  if (pane === 'wallets') return <Wallets state={state} />;
  return <Positions state={state} />;
}

function History({ state }) {
  const rows = describeHistory(state.payments, state.bots);
  const [openId, setOpenId] = useState(null);
  return (
    <section className="panel" aria-label="History">
      <h2>History</h2>
      <p className="preview-note">{PREVIEW}</p>
      {rows.length === 0 ? <p className="preview-note">No transactions yet.</p> : (
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

function Wallets({ state }) {
  const rows = describeWallets(state.wallets, state.bots);
  return (
    <section className="panel" aria-label="Wallets">
      <h2>Wallets</h2>
      <p className="preview-note">{PREVIEW}</p>
      <AnimatedList
        {...listLook()}
        items={rows.map(row => ({
          id: row.id,
          title: row.label,
          description: `${row.address} · ${row.bots.length ? row.bots.join(', ') : 'No agents assigned'}`,
          meta: row.frozen ? 'Frozen' : row.kind,
        }))}
      />
      <p className="preview-note">Freeze calls the policy API when that route is live.</p>
    </section>
  );
}

function Positions({ state }) {
  return <PositionBook positions={state.positions} bots={state.bots} wallets={state.wallets} />;
}
