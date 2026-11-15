'use client';

import { loopStepStateLabel } from '../lib/loop-steps.mjs';

export default function LoopSteps({ steps, note = '' }) {
  const rows = Array.isArray(steps) ? steps : [];
  return (
    <aside className="loop-beside" aria-label="Autonomous loop">
      <h2>Loop</h2>
      <p className="hint">Checkpointed run, step by step.</p>
      {note ? <p className="preview-note">{note}</p> : null}
      <ol className="loop-steps">
        {rows.map((step) => (
          <li key={step.id} className={`loop-step is-${step.state}`} data-state={step.state}>
            <span className="loop-step-label">{step.label}</span>
            <span className="loop-step-state">{loopStepStateLabel(step)}</span>
            {step.detail ? <span className="loop-step-detail">{step.detail}</span> : null}
          </li>
        ))}
      </ol>
    </aside>
  );
}
