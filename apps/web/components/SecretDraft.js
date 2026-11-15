'use client';

import { generatePassphrase, generatePassword } from '../lib/secret-generate.mjs';

export default function SecretDraft({
  label,
  value,
  generated,
  copied,
  acknowledged,
  onValue,
  onFill,
  onGenerated,
  onCopied,
  onAcknowledged,
  autoComplete = 'new-password',
  name = 'secret',
  disabled = false,
}) {
  function fill(kind) {
    const next = kind === 'password' ? generatePassword() : generatePassphrase();
    onGenerated(kind);
    if (onFill) onFill(next);
    else onValue(next);
    onCopied(false);
    onAcknowledged(false);
  }

  async function copy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      onCopied(true);
    } catch {
      onCopied(false);
    }
  }

  return (
    <div className="secret-draft">
      <div className="choice-row">
        <button type="button" className="ghost" onClick={() => fill('password')} disabled={disabled}>Generate password</button>
        <button type="button" className="ghost" onClick={() => fill('passphrase')} disabled={disabled}>Generate passphrase</button>
      </div>
      {generated && value ? (
        <>
          <p className="secret-preview">{value}</p>
          <p className="secret-warning" role="status">Copy this before you continue. It stays on this screen only until you accept.</p>
          <div className="choice-row">
            <button type="button" className="ghost" onClick={copy}>Copy</button>
            <label className="secret-ack">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={event => onAcknowledged(event.target.checked)}
              />
              I copied it
            </label>
          </div>
        </>
      ) : null}
      <label>
        {label}
        <input
          type={generated ? 'text' : 'password'}
          name={name}
          autoComplete={autoComplete}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            onGenerated(false);
            onCopied(false);
            onAcknowledged(false);
            onValue(event.target.value);
          }}
        />
      </label>
    </div>
  );
}
