'use client';

import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, ChevronRight, ExternalLink } from 'lucide-react';
import {
  describeHistory,
  describeWallets,
  SOLSCAN_DEVNET,
} from '../lib/money-views.mjs';
import PositionBook from './PositionBook';

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
        <div className="ledger">
          <div className="ledger-head" aria-hidden="true">
            <span />
            <span>Where</span>
            <span className="ledger-amount-head">Amount</span>
            <span />
          </div>
          <ul className="ledger-list">
            {rows.map(row => (
              <HistoryRow
                key={row.id}
                row={row}
                open={openId === row.id}
                onToggle={() => setOpenId(current => current === row.id ? null : row.id)}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function HistoryRow({ row, open, onToggle }) {
  const inflow = row.flow === 'in';
  const detailId = `payment-${row.id}`;
  return (
    <li className={`ledger-item${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="ledger-hit"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={onToggle}
      >
        <span className={`flow-mark${inflow ? ' is-in' : ' is-out'}`} aria-hidden="true">
          {inflow
            ? <ArrowDownLeft size={16} strokeWidth={2} />
            : <ArrowUpRight size={16} strokeWidth={2} />}
        </span>
        <span className="ledger-where">
          <strong>{row.counterparty}</strong>
          <small>{row.botName} · {row.protocol} · {row.cluster}</small>
        </span>
        <span className={`ledger-amount${inflow ? ' is-in' : ' is-out'}`}>
          <b>{row.signedFigure}</b>
          <small>{row.asset}</small>
        </span>
        <span className="ledger-chevron" aria-hidden="true">
          <ChevronRight size={14} strokeWidth={2} />
        </span>
        <span className="ledger-sr">
          {inflow ? 'Inflow, earned' : 'Outflow, paid'}
          {open ? ', details open' : ', show payment details'}
        </span>
      </button>
      <div className={`ledger-fold${open ? ' is-open' : ''}`}>
        <div className="ledger-fold-inner">
          <dl className="ledger-detail" id={detailId} inert={!open}>
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
        </div>
      </div>
    </li>
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
      <ul className="money-list">
        {rows.map(row => (
          <li key={row.id} className="money-row">
            <span className="dir">{row.kind}</span>
            <div>
              <strong>{row.label}</strong>
              <small className="addr">{row.address}</small>
              <small>{row.bots.length ? row.bots.join(', ') : 'No agents assigned'}</small>
            </div>
            <button
              className="ghost"
              type="button"
              disabled
              title="Freeze calls the policy API when that route is live"
            >
              {row.frozen ? 'Frozen' : 'Freeze'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Positions({ state }) {
  return <PositionBook positions={state.positions} bots={state.bots} wallets={state.wallets} />;
}
