'use client';


import { useEffect, useMemo, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { ExternalLink } from 'lucide-react';
import { SOLANA_CLUSTER } from '@ubc2026/contracts/solana';
import { filterBotHistory } from '../lib/bot-history.mjs';
import {
  describeHistory,
  describeSpendAlerts,
  describeWallets,
  SOLSCAN_SOLANA,
} from '../lib/money-views.mjs';
import { enrichPortfolio } from '../lib/dex-token.mjs';
import { buildEarningsSeries, mergeWalletPositions } from '../lib/earnings-chart.mjs';
import { readRetiredWalletIds } from '../lib/wallet-retire.mjs';
import { linkedWalletKey } from '../lib/wallet-provision.mjs';
import { flowName, partyFromToken } from '../lib/party-book.mjs';
import AddressCopy from './AddressCopy';
import GlideSelect from './GlideSelect';
import PositionBook from './PositionBook';
import TxnLog from './TxnLog';

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

export default function MoneyPane({ pane, state, onParty, ownerId, getAccessToken, onWallet }) {
  if (pane === 'history') return <History state={state} onParty={onParty} />;
  if (pane === 'wallets') return <Wallets state={state} />;
  return <Positions state={state} ownerId={ownerId} getAccessToken={getAccessToken} onWallet={onWallet} />;
}

function historyRows(state) {
  const payments = describeHistory(state.payments || [], state.bots || []).map((row, index) => ({
    id: row.id,
    botId: state.payments?.[index]?.botId ?? null,
    direction: row.flow,
    title: row.counterparty,
    detail: `${row.botName} · ${row.protocol}`,
    amount: row.baseUnits,
    asset: row.asset,
    party: partyFromToken(row.counterparty),
    explorerUrl: row.explorerUrl,
    legs: row.legs,
    badge: row.badge,
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
  const alerts = describeSpendAlerts(state.paymentCrossCheck);
  return (
    <section className="panel" aria-label="History">
      <h2>History</h2>
      {alerts.map(alert => (
        <p key={alert.walletId} className="preview-note" role="alert">
          Unapproved spend of {alert.excessLabel} {alert.asset}. The wallet is frozen.
        </p>
      ))}
      <div className="history-filters">
        <label>
          Agent
          <GlideSelect
            ariaLabel="Agent"
            size="sm"
            menuWidth={180}
            value={botId}
            options={[{ value: '', label: 'All agents' }, ...bots.map(item => ({ value: item.id, label: item.name }))]}
            onChange={setBotId}
          />
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
          <GlideSelect
            ariaLabel="Value"
            size="sm"
            menuWidth={160}
            value={minUnits}
            options={VALUES.map(item => ({ value: item.id, label: item.label }))}
            onChange={setMinUnits}
          />
        </label>
      </div>
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
      <Detail label="Amount" value={row.signedFigure} flow={row.flow} />
      <Detail label="Base units" value={`${row.baseUnits} ${row.asset}`} />
      <Detail label="Payment" value={row.id} />
      <Detail label="Signature" value={row.txSignature ?? 'Not broadcast yet'} />
      {row.badge === 'confirmed' ? <Detail label="Stream" value="Confirmed" /> : null}
      <div className="ledger-meta ledger-meta-link">
        <dt>Explorer</dt>
        <dd>
          <a href={row.explorerUrl ?? row.solscanUrl ?? SOLSCAN_SOLANA} target="_blank" rel="noreferrer">
            Open in Solana Explorer
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
      {rows.length === 0 ? <p className="quiet">No wallet yet.</p> : (
        <ul className="token-rows">
          {rows.map(row => (
            <li key={row.id} className="token-settings">
              <strong>{row.label}</strong>
              <AddressCopy address={row.address} />
              <small>{row.frozen ? 'Frozen' : row.kind}{row.bots.length ? ` · ${row.bots.join(', ')}` : ' · No agents assigned'}</small>
            </li>
          ))}
        </ul>
      )}
      <p className="quiet">Freeze calls the policy API when that route is live.</p>
    </section>
  );
}

function Positions({ state, ownerId, getAccessToken, onWallet }) {
  const { user } = usePrivy();
  const walletsKey = linkedWalletKey(user);
  const balancesKey = JSON.stringify((state.wallets || []).map(wallet => [wallet.address, wallet.holdings]));
  const [portfolio, setPortfolio] = useState(null);
  useEffect(() => {
    if (typeof getAccessToken !== 'function') return undefined;
    let stopped = false;
    const fail = () => {
      if (!stopped) setPortfolio(previous => ({ ownerId, data: previous?.ownerId === ownerId ? previous.data : null, failed: true }));
    };
    (async () => {
      try {
        const token = await getAccessToken();
        if (stopped) return;
        if (!token) return fail();
        const response = await fetch(`/api/portfolio?cluster=${SOLANA_CLUSTER}&positions=1`, {
          headers: {
            Authorization: `Bearer ${token}`,
            ...(ownerId ? { 'x-owner-id': ownerId } : {}),
          },
          cache: 'no-store',
        });
        const body = await response.json().catch(() => null);
        if (stopped) return;
        if (!response.ok || !body || typeof body !== 'object') return fail();
        setPortfolio({ ownerId, data: body });
        const enriched = await enrichPortfolio(body, {
          userId: user?.id || ownerId,
          storage: window.localStorage,
        });
        if (!stopped) setPortfolio({ ownerId, data: { ...enriched.portfolio, providers: body.providers } });
      } catch {
        fail();
      }
    })();
    return () => { stopped = true; };
  }, [balancesKey, getAccessToken, ownerId, user?.id, walletsKey]);

  const merged = useMemo(() => mergeWalletPositions({
    wallets: state.wallets,
    portfolio: portfolio?.ownerId === ownerId ? portfolio.data : null,
    retiredIds: state.retiredIds || readRetiredWalletIds(typeof window !== 'undefined' ? window.localStorage : null, ownerId),
  }), [ownerId, state.wallets, state.retiredIds, portfolio]);
  const earnings = useMemo(() => buildEarningsSeries({
    payments: state.payments,
  }), [state.payments]);
  const providerStatus = portfolio?.ownerId === ownerId ? portfolio : null;
  const incomplete = providerStatus?.data?.providers?.incomplete ?? [];
  const status = SOLANA_CLUSTER !== 'mainnet-beta' ? 'Provider positions are available on mainnet.'
    : providerStatus?.failed ? 'Could not refresh provider positions.'
    : !providerStatus ? 'Loading provider positions…'
    : incomplete.length ? `Could not load all positions from ${incomplete.join(' and ')}.`
    : null;

  return (
    <PositionBook
      positions={merged.positions}
      holdings={merged.holdings}
      status={status}
      bots={state.bots}
      wallets={merged.wallets}
      earnings={earnings}
      onWallet={onWallet}
    />
  );
}
