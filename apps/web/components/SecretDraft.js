'use client';

import { useState } from 'react';
import { Copy } from 'lucide-react';
import { copyText } from '../lib/copy-text.mjs';
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
  const [copyFailed, setCopyFailed] = useState(false);

  function fill() {
    const next = kind === 'passphrase' ? generatePassphrase() : generatePassword();
    onGenerated(kind === 'passphrase' ? 'passphrase' : 'password');
    if (onFill) onFill(next);
    else onValue(next);
    onCopied(false);
    setCopyFailed(false);
  }

  async function copy() {
    if (!value) return;
    const ok = await copyText(value);
    onCopied(ok);
    setCopyFailed(!ok);
  }

  const action = kind === 'passphrase' ? 'Generate passphrase' : 'Generate password';

  return (
    <div className="secret-draft">
      <span className="secret-label">{label}</span>
      <div className="secret-row">
        <button type="button" className="ghost" onClick={fill} disabled={disabled}>{action}</button>
        <div className="secret-box">
          <input
            className={generated ? 'secret-mask is-clear' : 'secret-mask'}
            type="text"
            name={name}
            autoComplete={autoComplete}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={value}
            disabled={disabled}
            onCopy={() => {
              onCopied(true);
              setCopyFailed(false);
            }}
            onChange={(event) => {
              onGenerated(false);
              onCopied(false);
              setCopyFailed(false);
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
        <p className="secret-warning" role="status">
          {copyFailed
            ? 'Copy failed. Select the field and copy it yourself, then continue.'
            : 'Copy this before you continue. It stays on this screen only until you accept.'}
        </p>
      ) : null}
    </div>
  );
}
