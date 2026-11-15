'use client';

import { useEffect, useState } from 'react';
import { actionLabel, formatBaseUnits, raisedCap } from '../lib/bot-experience.mjs';
import { Confirmation } from './ai/elements';

function capFields(type, current) {
  if (type === 'position-management') {
    return [{ key: 'maxLoss', label: 'Max loss' }];
  }
  return [
    { key: 'maxOutflow', label: 'Max outflow' },
    { key: 'maxPerTransaction', label: 'Max per transaction' },
  ];
}

export default function ApprovalPreview({ preview, botType = 'trading' }) {
  const [choice, setChoice] = useState(null);
  const [draft, setDraft] = useState({});
  const [raiseResult, setRaiseResult] = useState(null);

  useEffect(() => {
    setChoice(null);
    setRaiseResult(null);
    const next = {};
    for (const field of capFields(botType, preview?.currentCap)) {
      next[field.key] = preview?.currentCap?.[field.key] ?? '';
    }
    setDraft(next);
  }, [preview?.id, preview?.digest, botType]);

  function choose(action) {
    setRaiseResult(null);
    setChoice(action);
  }

  function submitRaise(event) {
    event.preventDefault();
    setRaiseResult(raisedCap(botType, preview.currentCap, draft));
  }

  return (
    <section className="panel approval-preview" aria-label="Approval preview">
      <h2>{preview?.title ?? 'Approval preview'}</h2>
      {(!preview || preview.state === 'clear' || preview.state === 'blocked') && (
        <p>{preview?.body}</p>
      )}
      {preview && (preview.state === 'approval-needed' || preview.state === 'over-budget') && (
        <>
          <p className="pill">● {preview.cluster} · preview before sign</p>
          <p className="approval-amount">{preview.outflowLabel}</p>
          <p>{preview.body}</p>
          <dl className="approval-facts">
            <div>
              <dt>To</dt>
              <dd>{preview.recipient}</dd>
            </div>
            <div>
              <dt>Fee cap</dt>
              <dd>{preview.feeLabel}</dd>
            </div>
            <div>
              <dt>Expected</dt>
              <dd>{preview.receiveLabel}</dd>
            </div>
            <div>
              <dt>Proposal digest</dt>
              <dd><code>{preview.digestShort}</code></dd>
            </div>
          </dl>
          {preview.violations.length > 0 && (
            <p className="form-error" role="alert">Over budget: {preview.violations.join(', ')}.</p>
          )}
          <Confirmation
            title="Confirm before this runs"
            actions={preview.actions.map(action => (
              <button
                key={action}
                type="button"
                className={action === 'raise-limit' ? 'ghost' : 'cta'}
                onClick={() => choose(action)}
              >
                {actionLabel(action)}
              </button>
            ))}
          />
          {choice && choice !== 'raise-limit' && (
            <p role="status">Recorded {actionLabel(choice)} for {preview.digestShort}. Nothing was signed.</p>
          )}
          {choice === 'raise-limit' && preview.currentCap && (
            <form className="raise-form" onSubmit={submitRaise}>
              {capFields(botType).map(field => (
                <label className="field" key={field.key}>
                  {field.label}
                  <input
                    inputMode="numeric"
                    value={draft[field.key] ?? ''}
                    onChange={event => setDraft(current => ({ ...current, [field.key]: event.target.value }))}
                  />
                  <small>
                    Current {formatBaseUnits(preview.currentCap[field.key], preview.currentCap.asset)}
                  </small>
                </label>
              ))}
              <button className="cta" type="submit">Save higher limit</button>
              {raiseResult?.ok && (
                <p role="status">Higher limit recorded. It is not signed and does not spend.</p>
              )}
              {raiseResult && !raiseResult.ok && (
                <p className="form-error" role="alert">
                  {raiseResult.reason === 'cannot-lower-limit'
                    ? 'Raise limit cannot lower a cap.'
                    : 'Enter the cap in base units.'}
                </p>
              )}
            </form>
          )}
        </>
      )}
    </section>
  );
}
