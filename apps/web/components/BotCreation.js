'use client';

import { useEffect, useState } from 'react';
import {
  applyTemplate,
  draftInputFromForm,
  initialForm,
  removeUserTemplate,
  saveTemplate,
  submitDraft,
  visibleTemplates,
  walletPickerOptions,
} from '../lib/creation-flow.mjs';

const TYPES = [
  ['trading', 'Trading'],
  ['shopping', 'Shopping'],
  ['position-management', 'Position management'],
];

const APPROVALS = [
  ['fully-automatic', 'Fully automatic'],
  ['capped-automatic', 'Capped automatic'],
  ['ask', 'Ask'],
];

export default function BotCreation({ ownerId, userTemplates, onTemplatesChange, onDraft, wallets = [] }) {
  const [form, setForm] = useState(() => initialForm(ownerId));
  const [error, setError] = useState('');
  const walletOptions = walletPickerOptions(Array.isArray(wallets) ? wallets : [], ownerId);
  const templates = visibleTemplates(userTemplates);

  useEffect(() => {
    setForm(current => (current.ownerId === ownerId ? current : initialForm(ownerId)));
  }, [ownerId]);

  function update(patch) {
    setForm(current => ({ ...current, ...patch }));
  }

  function run(action) {
    try {
      setError('');
      return action();
    } catch (caught) {
      setError(caught.message);
      return null;
    }
  }

  const showLoss = form.type === 'position-management';
  const showOutflow = form.type === 'trading' || form.type === 'shopping';

  return (
    <section className="panel create-panel" aria-label="Create bot">
      <h2>Create bot</h2>
      <p className="hint">
        Pick a type, a wallet, caps, and an approval mode. Create saves a draft. Enable is separate,
        so a template is not a live bot.
      </p>

      <div className="template-list" role="list" aria-label="Templates">
        {templates.map(template => (
          <div key={template.id} className="template-row" role="listitem">
            <div>
              <strong>{template.name}</strong>
              <small>{template.builtin ? 'Locked template' : 'Your template'} · {template.type}</small>
            </div>
            <div className="row-actions">
              <button type="button" className="ghost" onClick={() => run(() => update(applyTemplate(form, template)))}>
                Use
              </button>
              {template.deletable ? (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => run(() => onTemplatesChange(removeUserTemplate(userTemplates, template.id, ownerId)))}
                >
                  Delete
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <form
        className="create-form"
        onSubmit={event => {
          event.preventDefault();
          const draft = run(() => submitDraft(form, wallets));
          if (draft) onDraft(draft);
        }}
      >
        <label className="field">
          Name
          <input value={form.name} onChange={event => update({ name: event.target.value })} required maxLength={64} />
        </label>
        <label className="field">
          Goal
          <textarea value={form.goal} onChange={event => update({ goal: event.target.value })} required maxLength={4000} rows={3} />
        </label>

        <fieldset>
          <legend>Type</legend>
          <div className="choice-row">
            {TYPES.map(([type, label]) => (
              <button
                key={type}
                type="button"
                className="choice"
                aria-pressed={form.type === type}
                onClick={() => update({ type })}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="field">
          Wallet
          <select
            aria-label="Wallet"
            value={form.walletId}
            onChange={event => update({ walletId: event.target.value })}
            required
          >
            <option value="">Choose a wallet</option>
            {walletOptions.map(option => (
              <option key={option.wallet.id} value={option.wallet.id} disabled={!option.selectable}>
                {option.wallet.label} · {option.wallet.kind}{option.selectable ? '' : ' · frozen'}
              </option>
            ))}
          </select>
        </label>

        <fieldset>
          <legend>Caps</legend>
          <div className="choice-row">
            <button type="button" className="choice" aria-pressed={form.capMode === 'limited'} onClick={() => update({ capMode: 'limited' })}>
              Limited
            </button>
            <button type="button" className="choice" aria-pressed={form.capMode === 'unlimited'} onClick={() => update({ capMode: 'unlimited' })}>
              FRQ (no cap)
            </button>
          </div>
          <label className="field">
            Accounting asset
            <input value={form.asset} onChange={event => update({ asset: event.target.value })} maxLength={64} />
          </label>
          {form.capMode === 'limited' && showLoss ? (
            <label className="field">
              Max loss (base units)
              <input value={form.maxLoss} inputMode="numeric" onChange={event => update({ maxLoss: event.target.value })} />
            </label>
          ) : null}
          {form.capMode === 'limited' && showOutflow ? (
            <>
              <label className="field">
                Max outflow (base units)
                <input value={form.maxOutflow} inputMode="numeric" onChange={event => update({ maxOutflow: event.target.value })} />
              </label>
              <label className="field">
                Max per transaction (base units)
                <input value={form.maxPerTransaction} inputMode="numeric" onChange={event => update({ maxPerTransaction: event.target.value })} />
              </label>
            </>
          ) : null}
        </fieldset>

        <fieldset>
          <legend>Approval mode</legend>
          <div className="choice-row">
            {APPROVALS.map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className="choice"
                aria-pressed={form.approvalMode === mode}
                onClick={() => update({ approvalMode: mode })}
              >
                {label}
              </button>
            ))}
          </div>
          {form.approvalMode === 'capped-automatic' ? (
            <label className="field">
              Auto-approve cap (base units)
              <input value={form.autoApproveCap} inputMode="numeric" onChange={event => update({ autoApproveCap: event.target.value })} />
            </label>
          ) : null}
        </fieldset>

        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="row-actions">
          <button className="cta" type="submit">Create draft</button>
          <button
            className="ghost"
            type="button"
            onClick={() => {
              const template = run(() => saveTemplate(form));
              if (template) onTemplatesChange([...userTemplates, template]);
            }}
          >
            Save as template
          </button>
        </div>
      </form>
      <p className="hint">Draft input keeps the wallet picker on the owner&apos;s Privy wallets. {draftReady(form, wallets)}</p>
    </section>
  );
}

function draftReady(form, wallets) {
  const input = draftInputFromForm(form, wallets);
  const ready = input.type && input.walletId && input.cap && input.approvalMode;
  return ready ? 'Required steps are filled. Create draft does not enable the bot.' : 'Type, wallet, caps, and approval mode are required.';
}
