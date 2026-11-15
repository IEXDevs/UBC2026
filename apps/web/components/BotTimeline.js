'use client';

import { TaskList } from './ai/elements';

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

function statusFor(kind) {
  if (kind === 'verify.mismatch') return 'error';
  if (kind === 'tool.call' || kind === 'approval.requested' || kind === 'tx.submitted' || kind === 'verify.attempt') return 'running';
  return 'done';
}

export default function BotTimeline({ entries, live, onWhy }) {
  const items = entries.map((entry) => ({
    id: entry.id,
    status: statusFor(entry.kind),
    title: `${KIND_LABELS[entry.kind] ?? entry.kind}. ${entry.summary || ''}${formatWhen(entry.at) ? ` ${formatWhen(entry.at)}` : ''}`,
    action: (
      <button type="button" className="text-btn" onClick={() => onWhy(entry)}>Why</button>
    ),
  }));

  return (
    <section className="panel" aria-label="Live timeline">
      <h2>Live timeline</h2>
      <p className="hint">{live ? 'Updating from the agent runtime.' : 'Showing the latest stored tool events.'}</p>
      {items.length === 0 ? <p>No tool events yet.</p> : <TaskList items={items} />}
    </section>
  );
}
