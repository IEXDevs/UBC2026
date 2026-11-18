'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon, Download01Icon } from '@hugeicons/core-free-icons';
import { ensureAccountCode } from '../lib/account-code.mjs';
import { displayFileName } from '../lib/file-name.mjs';
import { fetchFilePreviewBytes, isStoredFileSecret } from '../lib/file-preview-load.mjs';
import { fileAvailability, sessionPreviewUrl } from '../lib/file-session.mjs';
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
  const session = sessionPreviewUrl(file?.id);
  if (session.startsWith('blob:')) return session;
  return '';
}

export default function FileStage({ file, ownerId = '', getAccessToken = null, onClose, onMissing = null }) {
  const [shown, setShown] = useState(false);
  const [remote, setRemote] = useState('');
  const [remoteStatus, setRemoteStatus] = useState('');
  const [remoteMessage, setRemoteMessage] = useState('');
  const [retryTick, setRetryTick] = useState(0);
  const [body, setBody] = useState(null);
  const getAccessTokenRef = useRef(getAccessToken);
  const onMissingRef = useRef(onMissing);
  getAccessTokenRef.current = getAccessToken;
  onMissingRef.current = onMissing;
  const fileId = typeof file?.id === 'string' ? file.id : '';

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
    if (viewUrl(file) || !ownerId || !isStoredFileSecret(fileId)) {
      setRemote('');
      setRemoteStatus('');
      setRemoteMessage('');
      return undefined;
    }
    let gone = false;
    let objectUrl = '';
    setRemote('');
    setRemoteStatus('loading');
    setRemoteMessage('');
    setBody(null);
    (async () => {
      let token = '';
      try {
        token = (await getAccessTokenRef.current?.()) || '';
      } catch {
        token = '';
      }
      const accountCode = ensureAccountCode(window.localStorage, ownerId);
      if (!token || !accountCode || gone) {
        if (!gone) {
          setRemoteStatus('error');
          setRemoteMessage('Sign in again to open this file, or attach a fresh copy from this device.');
        }
        return;
      }
      const loaded = await fetchFilePreviewBytes({
        url: `/api/files/${fileId}`,
        headers: {
          'x-owner-id': ownerId,
          'x-account-code': accountCode,
          authorization: `Bearer ${token}`,
        },
      });
      if (gone) return;
      if (!loaded.ok) {
        setRemoteStatus(loaded.state);
        setRemoteMessage(loaded.message);
        if (loaded.state === 'gone') onMissingRef.current?.(fileId);
        return;
      }
      const type = stageKind(file) === 'pdf'
        ? 'application/pdf'
        : (loaded.type || 'application/octet-stream');
      objectUrl = URL.createObjectURL(new Blob([loaded.bytes], { type }));
      setRemote(objectUrl);
      setRemoteStatus('');
      setRemoteMessage('');
    })().catch(() => {
      if (!gone) {
        setRemoteStatus('error');
        setRemoteMessage('Could not load this file. Check your connection and try again.');
      }
    });
    return () => {
      gone = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  // Depend on stable ids only — callback identity must not restart the load.
  }, [fileId, ownerId, retryTick, file]);

  const url = viewUrl(file) || (remote.startsWith('blob:') ? remote : '');
  const kind = stageKind(file);
  const availability = fileAvailability({
    id: fileId,
    url,
    remoteStatus,
    remoteMessage,
  });

  useEffect(() => {
    if (!url || (kind !== 'code' && kind !== 'doc')) {
      setBody(null);
      return undefined;
    }
    let gone = false;
    setBody(null);
    const timer = window.setTimeout(() => {
      if (!gone) setBody({ error: 'empty' });
    }, 12_000);
    readPreview(url, kind).then((next) => {
      if (!gone) setBody(next);
    }).catch(() => {
      if (!gone) setBody({ error: 'empty' });
    }).finally(() => {
      window.clearTimeout(timer);
    });
    return () => {
      gone = true;
      window.clearTimeout(timer);
    };
  }, [url, kind]);

  if (!file || typeof document === 'undefined') return null;
  const name = displayFileName(file.name) || file.name || 'File';
  const playable = Boolean(url) && (kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'pdf');
  const codeText = kind === 'code' && typeof body?.text === 'string' ? body.text : '';
  const paragraphs = kind === 'doc' && Array.isArray(body?.paragraphs) ? body.paragraphs : [];
  const waiting = Boolean(url) && (kind === 'code' || kind === 'doc') && !body;
  const emptyPreview = !playable && !codeText && paragraphs.length === 0 && !waiting;

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
          {waiting || (emptyPreview && availability.state === 'loading') ? (
            <div className="file-stage-card">
              <strong>{name}</strong>
              <p>Opening this file.</p>
            </div>
          ) : null}
          {emptyPreview && availability.state !== 'loading' ? (
            <div className="file-stage-card">
              <strong>{name}</strong>
              <p>
                {kind === 'doc-old'
                  ? 'This is an older Word file. Save it as .docx to view it here.'
                  : body?.error === 'long'
                    ? 'This file is too long to preview here.'
                    : body?.error === 'doc' || body?.error === 'binary'
                      ? 'This file did not open. Try attaching a fresh copy from this device.'
                      : body?.error === 'empty' && url
                        ? 'This file did not open. Try again or attach a fresh copy from this device.'
                        : availability.message}
              </p>
              {availability.state === 'error' || body?.error === 'empty' ? (
                <button type="button" className="solid" onClick={() => setRetryTick(value => value + 1)}>
                  Try again
                </button>
              ) : null}
            </div>
          ) : null}
          <figcaption>{name}</figcaption>
        </figure>
      </div>
    </div>,
    document.body,
  );
}
