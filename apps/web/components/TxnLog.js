'use client';

import { ArrowDownLeft, ArrowUpRight, ExternalLink, Repeat } from 'lucide-react';
import { TokenIcon } from './PhantomIcons';
import { formatBaseUnits } from '../lib/money-views.mjs';
import { flowName, signedUsdc } from '../lib/party-book.mjs';

function printDelta(delta, decimals = 6) {
  const text = typeof delta === 'string' ? delta : '';
  const negative = text.startsWith('-');
  const abs = negative ? text.slice(1) : text;
  const shown = formatBaseUnits(abs === '0' || abs === '' ? '0' : abs, decimals);
  if (shown === '0') return '0';
  return `${negative ? '−' : '+'}${shown}`;
}

export default function TxnLog({ rows = [], onParty, onToggle, openId = null, renderDetail, empty = 'No transactions yet.' }) {
  if (rows.length === 0) return <p className="preview-note phantom-empty-note">{empty}</p>;

  return (
    <div className="txn-log phantom-history-wrap">
      <div className="phantom-history-section-header">
        <span className="phantom-history-date-label">Today</span>
      </div>
      <ul className="phantom-history-list">
        {rows.map(row => {
          const incoming = row.direction === 'in';
          const isSwap = row.title?.toLowerCase().includes('swap') || (Array.isArray(row.legs) && row.legs.length > 1);
          const ActionIcon = isSwap ? Repeat : incoming ? ArrowDownLeft : ArrowUpRight;
          const legs = Array.isArray(row.legs) && row.legs.length > 1 ? row.legs : null;

          const figure = legs ? (
            <span className="txn-legs phantom-history-legs">
              {legs.map(leg => {
                const legIn = leg.direction === 'in' || !String(leg.delta || '').startsWith('-');
                return (
                  <span key={leg.mint || leg.symbol} className={`phantom-history-leg ${legIn ? 'is-in' : 'is-out'}`}>
                    <b>{printDelta(leg.delta, leg.decimals ?? 6)}</b>
                    <small>{leg.symbol || 'token'}</small>
                  </span>
                );
              })}
            </span>
          ) : (
            <div className={`phantom-history-amount ${incoming ? 'is-in' : 'is-out'}`}>
              <b>{signedUsdc(incoming ? row.amount : `-${row.amount}`)}</b>
              <small>{row.asset || 'USDC'}</small>
            </div>
          );

          const figureClass = `txn-fig phantom-history-fig${legs ? '' : ` ${flowName(row.direction)}`}`;

          return (
            <li key={row.id} className={`phantom-history-item ${openId === row.id ? 'is-open' : ''}`}>
              <div
                className="txn-row phantom-history-card"
                onClick={(event) => {
                  if (event.target.closest('a, button')) return;
                  if (row.explorerUrl) {
                    window.open(row.explorerUrl, '_blank', 'noopener,noreferrer');
                    return;
                  }
                  onToggle?.(row.id);
                }}
              >
                <div className="phantom-history-icon-col">
                  <TokenIcon
                    symbol={row.asset || (legs ? legs[0]?.symbol : 'SOL')}
                    size={38}
                    showSolanaBadge={false}
                  />
                  <span className={`phantom-action-badge ${isSwap ? 'is-swap' : incoming ? 'is-in' : 'is-out'}`}>
                    <ActionIcon size={11} strokeWidth={2.5} />
                  </span>
                </div>

                <div className="txn-copy phantom-history-copy">
                  <div className="phantom-history-main-line">
                    {row.party && onParty ? (
                      <button type="button" className="party-link" onClick={() => onParty(row.party)}>
                        {row.title}
                      </button>
                    ) : (
                      <strong>{row.title}</strong>
                    )}
                    {row.badge === 'confirmed' ? <span className="txn-badge phantom-badge-sm">Confirmed</span> : null}
                  </div>
                  {row.detail ? <small className="phantom-history-sub">{row.detail}</small> : null}
                </div>

                {row.explorerUrl ? (
                  <a className={figureClass} href={row.explorerUrl} target="_blank" rel="noreferrer">
                    {figure}
                    <ExternalLink size={12} strokeWidth={1.75} />
                    <span className="sr-only">Open in Solana Explorer</span>
                  </a>
                ) : onToggle ? (
                  <button
                    type="button"
                    className={figureClass}
                    aria-expanded={openId === row.id}
                    onClick={() => onToggle(row.id)}
                  >
                    {figure}
                  </button>
                ) : (
                  <div className={figureClass}>{figure}</div>
                )}
              </div>
              {openId === row.id && renderDetail ? <div className="txn-fold">{renderDetail(row)}</div> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
