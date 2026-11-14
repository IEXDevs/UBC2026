'use client';

import AnimatedList from './AnimatedList';
import { listLook } from './listLook';

const KIND_LABELS = {
  'tool.call': 'Tool',
  'trust.gate': 'Trust',
  'verify.attempt': 'Verify',
  'verify.settled': 'Verify',
  'verify.mismatch': 'Mismatch',
  'approval.requested': 'Approval',
  'approval.granted': 'Approval',
  'approval.consumed': 'Approval',
  'payment.x402': 'x402',
  'tx.submitted': 'Transaction',
  'tx.confirmed': 'Transaction',
};

function formatWhen(at) {
  if (!Number.isSafeInteger(at)) return '';
  return new Date(at).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

export default function BotTimeline({ entries, live, onWhy }) {
  const items = entries.map(entry => ({
    id: entry.id,
    title: KIND_LABELS[entry.kind] ?? entry.kind,
    description: entry.summary,
    meta: formatWhen(entry.at),
  }));

  return (
    <section className="panel" aria-label="Live timeline">
      <h2>Live timeline</h2>
      <p className="hint">{live ? 'Updating from the agent runtime.' : 'Showing the latest stored tool events.'}</p>
      {items.length === 0 ? (
        <p>No tool events yet.</p>
      ) : (
        <AnimatedList
          {...listLook()}
          items={items}
          onItemSelect={(_item, index) => onWhy(entries[index])}
        />
      )}
    </section>
  );
}
