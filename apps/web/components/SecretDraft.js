'use client';

import { Copy } from 'lucide-react';
import { generatePassphrase, generatePassword } from '../lib/secret-generate.mjs';

export default function SecretDraft({
  kind,
  label,
  value,
  generated,
  copied,
  onValue,
  onFill,
  onGenerated,
  onCopied,
  autoComplete = 'new-password',
  name = 'secret',
  disabled = false,
}) {
  function fill() {
    const next = kind === 'passphrase' ? generatePassphrase() : generatePassword();
    onGenerated(kind === 'passphrase' ? 'passphrase' : 'password');
    if (onFill) onFill(next);
    else onValue(next);
    onCopied(false);
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

  const action = kind === 'passphrase' ? 'Generate passphrase' : 'Generate password';

  return (
    <div className="secret-draft">
      <span className="secret-label">{label}</span>
      <div className="secret-row">
        <button type="button" className="ghost" onClick={fill} disabled={disabled}>{action}</button>
        <div className="secret-box">
          <input
            type={generated ? 'text' : 'password'}
            name={name}
            autoComplete={autoComplete}
            value={value}
            disabled={disabled}
            onChange={(event) => {
              onGenerated(false);
              onCopied(false);
              onValue(event.target.value);
            }}
          />
          <button
            type="button"
            className="secret-copy"
            aria-label="Copy"
            disabled={!value}
            onClick={copy}
          >
            <Copy size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      </div>
      {generated && value ? (
        <p className="secret-warning" role="status">Copy this before you continue. It stays on this screen only until you accept.</p>
      ) : null}
    </div>
  );
}
