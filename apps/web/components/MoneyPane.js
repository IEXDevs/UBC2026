'use client';

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { filterBotHistory } from '../lib/bot-history.mjs';
import {
  describeHistory,
  describeWallets,
  SOLSCAN_DEVNET,
} from '../lib/money-views.mjs';
import { flowName, partyFromToken } from '../lib/party-book.mjs';
import AnimatedList from './AnimatedList';
import PositionBook from './PositionBook';
import TxnLog from './TxnLog';
import { listLook } from './listLook';

const PREVIEW = 'Preview rows. Live payments, wallets, and positions stay empty until the Worker API leaves stub status.';

const FLOWS = [
  { id: 'all', label: 'All' },
  { id: 'in', label: 'Inflow' },
  { id: 'out', label: 'Outflow' },
];

const VALUES = [
  { id: '0', label: 'Any value' },
  { id: '1000000', label: '≥ 1 USDC' },
  { id: '5000000', label: '≥ 5 USDC' },
  { id: '10000000', label: '≥ 10 USDC' },
];

export default function MoneyPane({ pane, state, onParty }) {
  if (pane === 'history') return <History state={state} onParty={onParty} />;
  if (pane === 'wallets') return <Wallets state={state} />;
  return <Positions state={state} />;
}

function historyRows(state) {
  const payments = describeHistory(state.payments || [], state.bots || []).map((row, index) => ({
    id: row.id,
    botId: state.payments?.[index]?.botId ?? null,
    direction: row.flow,
    title: row.counterparty,
    detail: `${row.botName} · ${row.protocol} · ${row.cluster}`,
    amount: row.baseUnits,
    asset: row.asset,
    party: partyFromToken(row.counterparty),
    explorerUrl: row.explorerUrl,
    legs: row.legs,
    record: row,
  }));
  const transfers = (state.transfers || []).map(row => ({
    id: row.id,
    botId: row.botId ?? null,
    direction: row.direction === 'in' ? 'in' : 'out',
    title: `@${row.handle}`,
    detail: 'Platform',
    amount: row.amount,
    asset: 'USDC',
    party: partyFromToken(`@${row.handle}`),
    record: null,
  }));
  return [...transfers, ...payments];
}

function History({ state, onParty }) {
  const rows = historyRows(state);
  const [openId, setOpenId] = useState(null);
  const [flow, setFlow] = useState('all');
  const [botId, setBotId] = useState('');
  const [minUnits, setMinUnits] = useState('0');
  const shown = filterBotHistory(rows, { botId, flow, minUnits });
  const bots = state.bots || [];
  return (
    <section className="panel" aria-label="History">
      <h2>History</h2>
      <div className="history-filters">
        <label>
          Bot
          <select value={botId} onChange={event => setBotId(event.target.value)}>
            <option value="">All bots</option>
            {bots.map(item => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
        <div className="library-filters" role="group" aria-label="Direction">
          {FLOWS.map(item => (
            <button
              key={item.id}
              type="button"
              className={flow === item.id ? 'is-on' : ''}
              aria-pressed={flow === item.id}
              onClick={() => setFlow(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label>
          Value
          <select value={minUnits} onChange={event => setMinUnits(event.target.value)}>
            {VALUES.map(item => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="preview-note">{PREVIEW}</p>
      <TxnLog
        rows={shown}
        onParty={onParty}
        openId={openId}
        onToggle={id => setOpenId(current => current === id ? null : id)}
        renderDetail={row => (row.record ? <HistoryDetail row={row.record} /> : null)}
        empty="No history for this filter."
      />
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
      <Detail label="Amount" value={row.signedFigure} flow={row.flow} />
      <Detail label="Base units" value={`${row.baseUnits} ${row.asset}`} />
      <Detail label="Payment" value={row.id} />
      <Detail label="Signature" value={row.txSignature ?? 'Not broadcast yet'} />
      <div className="ledger-meta ledger-meta-link">
        <dt>Explorer</dt>
        <dd>
          <a href={row.explorerUrl ?? row.solscanUrl ?? SOLSCAN_DEVNET} target="_blank" rel="noreferrer">
            {row.explorerUrl || row.solscanUrl ? 'Open in Solana Explorer' : 'Open devnet explorer'}
            <ExternalLink size={14} strokeWidth={1.75} />
          </a>
        </dd>
      </div>
    </dl>
  );
}

function Detail({ label, value, flow }) {
  return (
    <div className="ledger-meta">
      <dt>{label}</dt>
      <dd className={flow ? flowName(flow) : undefined}>{value}</dd>
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
