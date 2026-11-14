'use client';

/**
 * Placeholder for ElevenAgents Talk UI.
 * Voice tools must hit the same permissioned APIs as the glass UI —
 * never a parallel spend path.
 */
export default function TalkStub({ botName = 'agent' }) {
  return (
    <section className="panel" aria-label="Voice talk stub">
      <h2>Talk</h2>
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>
        ElevenAgents orb wires here. Spoken actions for <strong>{botName}</strong> still
        go through trust → verify → policy → approval.
      </p>
      <button className="cta" type="button" disabled title="Requires ElevenLabs agent id">
        Start voice session
      </button>
    </section>
  );
}
