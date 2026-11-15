'use client';

import { ArrowDownLeft, ArrowUpRight, ExternalLink } from 'lucide-react';
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
  if (rows.length === 0) return <p className="preview-note">{empty}</p>;

  return (
    <div className="txn-log">
      <ul>
        {rows.map(row => {
          const incoming = row.direction === 'in';
          const Icon = incoming ? ArrowDownLeft : ArrowUpRight;
          const legs = Array.isArray(row.legs) && row.legs.length > 1 ? row.legs : null;
          const figure = legs ? (
            <span className="txn-legs">
              {legs.map(leg => (
                <span key={leg.mint || leg.symbol} className={flowName(leg.direction)}>
                  <b>{printDelta(leg.delta, leg.decimals ?? 6)}</b>
                  <small>{leg.symbol || 'token'}</small>
                </span>
              ))}
            </span>
          ) : (
            <>
              <b>{signedUsdc(incoming ? row.amount : `-${row.amount}`)}</b>
              <small>{row.asset}</small>
            </>
          );
          const figureClass = `txn-fig${legs ? '' : ` ${flowName(row.direction)}`}`;
          return (
            <li key={row.id} className={openId === row.id ? 'is-open' : ''}>
              <div
                className="txn-row"
                onClick={(event) => {
                  if (event.target.closest('a, button')) return;
                  if (row.explorerUrl) {
                    window.open(row.explorerUrl, '_blank', 'noopener,noreferrer');
                    return;
                  }
                  onToggle?.(row.id);
                }}
              >
                {onToggle ? (
                  <button type="button" className={`txn-dir ${flowName(row.direction)}`} aria-expanded={openId === row.id} onClick={() => onToggle(row.id)}>
                    <Icon size={16} strokeWidth={1.75} />
                    <span className="sr-only">{incoming ? 'Incoming' : 'Outgoing'}</span>
                  </button>
                ) : (
                  <span className={`txn-dir ${flowName(row.direction)}`}>
                    <Icon size={16} strokeWidth={1.75} />
                    <span className="sr-only">{incoming ? 'Incoming' : 'Outgoing'}</span>
                  </span>
                )}
                <div className="txn-copy">
                  {row.party && onParty ? (
                    <button type="button" className="party-link" onClick={() => onParty(row.party)}>{row.title}</button>
                  ) : <strong>{row.title}</strong>}
                  {row.detail ? <small>{row.detail}</small> : null}
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
                  <span className={figureClass}>{figure}</span>
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
