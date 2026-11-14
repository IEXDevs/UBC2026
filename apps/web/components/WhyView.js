'use client';

function brief(value) {
  if (typeof value !== 'string' || value.length < 16) return value || '';
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

export default function WhyView({ why }) {
  if (!why) return null;
  const facts = why.digests ? brief(why.digests.facts) : '';
  const proposal = why.digests ? brief(why.digests.proposal) : '';
  const record = why.digests ? brief(why.digests.decision) : '';
  return (
    <section className="panel why-view" id="why-did-it-do-this" aria-label="Why did it do this?">
      <h2>{why.title}</h2>
      {why.focus ? <p className="hint">{why.focus.summary}</p> : null}
      {why.lines.map(line => <p key={line}>{line}</p>)}
      {why.digests ? (
        <p className="why-ids">
          <span>Facts {facts}</span>
          <span>Proposal {proposal}</span>
          <span>Record {record}</span>
        </p>
      ) : null}
    </section>
  );
}
