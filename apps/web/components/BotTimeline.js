'use client';

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
  return (
    <section className="panel" aria-label="Live timeline">
      <h2>Live timeline</h2>
      <p className="hint">{live ? 'Updating from the agent runtime.' : 'Showing the latest stored tool events.'}</p>
      {entries.length === 0 ? (
        <p>No tool events yet.</p>
      ) : (
        <ol className="timeline">
          {entries.map(entry => (
            <li key={entry.id}>
              <time dateTime={new Date(entry.at).toISOString()}>{formatWhen(entry.at)}</time>
              <strong>{KIND_LABELS[entry.kind] ?? entry.kind}</strong>
              <span>{entry.summary}</span>
              <button type="button" className="ghost timeline-why" onClick={() => onWhy(entry)}>
                Why did it do this?
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
