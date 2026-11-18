'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|ogg)$/i;

function viewUrl(file) {
  const url = typeof file?.url === 'string' ? file.url.trim() : '';
  if (url.startsWith('blob:') || url.startsWith('data:image/') || url.startsWith('data:video/') || url.startsWith('data:audio/')) return url;
  return '';
}

function mediaKind(file) {
  const type = typeof file?.type === 'string' ? file.type : '';
  const name = typeof file?.name === 'string' ? file.name : '';
  if (type.startsWith('video/') || VIDEO_EXT.test(name)) return 'video';
  if (type.startsWith('audio/') || AUDIO_EXT.test(name)) return 'audio';
  if (type.startsWith('image/') || IMAGE_EXT.test(name)) return 'image';
  return 'file';
}

export default function FileStage({ file, onClose }) {
  const [shown, setShown] = useState(false);

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

  if (!file || typeof document === 'undefined') return null;
  const url = viewUrl(file);
  const kind = mediaKind(file);
  const name = file.name || 'File';
  const playable = Boolean(url) && (kind === 'image' || kind === 'video' || kind === 'audio');

  return createPortal(
    <div
      className={`browser-preview file-stage${shown ? ' is-open' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={name}
      onMouseDown={onClose}
    >
      <button
        type="button"
        className="browser-preview-close"
        aria-label="Close file"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={onClose}
      >
        <X size={18} strokeWidth={1.75} />
      </button>
      <div className="browser-preview-stage" onMouseDown={(event) => event.stopPropagation()}>
        <figure className="file-stage-frame">
          {playable && kind === 'image' ? <img src={url} alt={name} /> : null}
          {playable && kind === 'video' ? <video src={url} controls playsInline /> : null}
          {playable && kind === 'audio' ? <audio src={url} controls /> : null}
          {!playable ? (
            <div className="file-stage-card">
              <strong>{name}</strong>
              <p>This name is in the file catalog. Open the file again from this device to view it.</p>
            </div>
          ) : null}
          <figcaption>{name}</figcaption>
        </figure>
      </div>
    </div>,
    document.body,
  );
}
