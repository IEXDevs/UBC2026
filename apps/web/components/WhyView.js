'use client';

export default function WhyView({ why }) {
  if (!why) return null;
  return (
    <section className="panel why-view" id="why-did-it-do-this" aria-label="Why did it do this?">
      <h2>{why.title}</h2>
      {why.focus && (
        <p className="hint">About this event: {why.focus.summary}</p>
      )}
      {why.lines.map(line => <p key={line}>{line}</p>)}
      {why.digests && (
        <dl className="approval-facts">
          <div>
            <dt>Facts</dt>
            <dd><code>{why.digests.facts}</code></dd>
          </div>
          <div>
            <dt>Proposal</dt>
            <dd><code>{why.digests.proposal}</code></dd>
          </div>
          <div>
            <dt>Decision record</dt>
            <dd><code>{why.digests.decision}</code></dd>
          </div>
        </dl>
      )}
      {why.memo && (
        <p className="memo"><code>{why.memo}</code></p>
      )}
      {why.related?.length > 0 && (
        <ul className="why-related">
          {why.related.map(entry => (
            <li key={entry.id}>{entry.summary}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
