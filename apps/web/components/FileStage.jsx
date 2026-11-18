'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon, Download01Icon } from '@hugeicons/core-free-icons';
import { ensureAccountCode } from '../lib/account-code.mjs';
import { readPreview, stageKind } from '../lib/file-view.mjs';

function StageIcon({ icon, label, className = '', onClick }) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      type="button"
      className={`file-stage-action${className ? ` ${className}` : ''}${pressed ? ' is-pressed' : ''}`}
      aria-label={label}
      onMouseDown={(event) => {
        event.stopPropagation();
        setPressed(false);
        requestAnimationFrame(() => setPressed(true));
      }}
      onAnimationEnd={() => setPressed(false)}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
    >
      <HugeiconsIcon icon={icon} size={18} strokeWidth={1.75} />
    </button>
  );
}

function saveFile(url, name) {
  const link = document.createElement('a');
  link.href = url;
  link.download = (name || 'file').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'file';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function viewUrl(file) {
  const url = typeof file?.url === 'string' ? file.url.trim() : '';
  if (url.startsWith('blob:') || url.startsWith('data:image/') || url.startsWith('data:video/') || url.startsWith('data:audio/')) return url;
  return '';
}

export default function FileStage({ file, ownerId = '', getAccessToken = null, onClose, onMissing = null }) {
  const [shown, setShown] = useState(false);
  const [remote, setRemote] = useState('');
  const [body, setBody] = useState(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  useEffect(() => {
    if (viewUrl(file) || !ownerId || !/^[0-9a-z]{128}$/.test(file?.id || '')) {
      setRemote('');
      return undefined;
    }
    let gone = false;
    let objectUrl = '';
    (async () => {
      const token = await getAccessToken?.();
      const accountCode = ensureAccountCode(window.localStorage, ownerId);
      if (!token || !accountCode || gone) return;
      const response = await fetch(`/api/files/${file.id}`, {
        headers: {
          'x-owner-id': ownerId,
          'x-account-code': accountCode,
          authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok || gone) {
        if (response && response.status === 404) {
          const data = await response.json().catch(() => ({}));
          if (data?.gone === true) onMissing?.(file.id);
        }
        return;
      }
      const bytes = await response.arrayBuffer();
      const type = stageKind(file) === 'pdf'
        ? 'application/pdf'
        : (response.headers.get('content-type') || 'application/octet-stream');
      objectUrl = URL.createObjectURL(new Blob([bytes], { type }));
      if (!gone) setRemote(objectUrl);
    })().catch(() => {});
    return () => {
      gone = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file, ownerId, getAccessToken, onMissing]);

  const url = viewUrl(file) || (remote.startsWith('blob:') ? remote : '');
  const kind = stageKind(file);

  useEffect(() => {
    if (!url || (kind !== 'code' && kind !== 'doc')) {
      setBody(null);
      return undefined;
    }
    let gone = false;
    setBody(null);
    readPreview(url, kind).then((next) => {
      if (!gone) setBody(next);
    }).catch(() => {
      if (!gone) setBody({ error: 'empty' });
    });
    return () => {
      gone = true;
    };
  }, [url, kind]);

  if (!file || typeof document === 'undefined') return null;
  const name = file.name || 'File';
  const playable = Boolean(url) && (kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'pdf');
  const codeText = kind === 'code' && typeof body?.text === 'string' ? body.text : '';
  const paragraphs = kind === 'doc' && Array.isArray(body?.paragraphs) ? body.paragraphs : [];
  const waiting = Boolean(url) && (kind === 'code' || kind === 'doc') && !body;

  return createPortal(
    <div
      className={`browser-preview file-stage${shown ? ' is-open' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={name}
      onMouseDown={onClose}
    >
      <div className="file-stage-actions" onMouseDown={(event) => event.stopPropagation()}>
        {url ? (
          <StageIcon
            icon={Download01Icon}
            label={`Download ${name}`}
            className={`file-stage-download${kind === 'image' ? ' is-image' : ''}`}
            onClick={() => saveFile(url, name)}
          />
        ) : null}
        <StageIcon icon={Cancel01Icon} label="Close file" className="file-stage-close" onClick={onClose} />
      </div>
      <div className="browser-preview-stage" onMouseDown={(event) => event.stopPropagation()}>
        <figure className="file-stage-frame">
          {playable && kind === 'image' ? <img src={url} alt={name} /> : null}
          {playable && kind === 'video' ? <video src={url} controls playsInline /> : null}
          {playable && kind === 'audio' ? <audio src={url} controls /> : null}
          {playable && kind === 'pdf' ? <iframe className="file-stage-pdf" src={url} title={name} /> : null}
          {codeText ? <pre className="file-stage-code">{codeText}</pre> : null}
          {paragraphs.length > 0 ? (
            <article className="file-stage-doc">
              {paragraphs.map((line, index) => <p key={`${index}-${line.slice(0, 24)}`}>{line}</p>)}
            </article>
          ) : null}
          {waiting ? (
            <div className="file-stage-card">
              <strong>{name}</strong>
              <p>Opening this file.</p>
            </div>
          ) : null}
          {!playable && !codeText && paragraphs.length === 0 && !waiting ? (
            <div className="file-stage-card">
              <strong>{name}</strong>
              <p>
                {kind === 'doc-old'
                  ? 'This is an older Word file. Save it as .docx to view it here.'
                  : body?.error === 'long'
                    ? 'This file is too long to preview here.'
                    : body?.error === 'doc' || body?.error === 'binary'
                      ? 'This file did not open. Try it again from this device.'
                      : 'This name is in the file catalog. Open the file again from this device to view it.'}
              </p>
            </div>
          ) : null}
          <figcaption>{name}</figcaption>
        </figure>
      </div>
    </div>,
    document.body,
  );
}
