'use client';

import ModalClose from './ModalClose';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Doc01Icon, File02Icon, Folder01Icon, Pdf01Icon, Ppt01Icon, Xls01Icon, Zip01Icon } from '@hugeicons/core-free-icons';

const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i;

export function isImageFile(file) {
  const type = file?.type || '';
  return type.startsWith('image/') || IMAGE.test(file?.name || '');
}

export function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function kindOf(file) {
  const name = (file?.name || '').toLowerCase();
  const type = file?.type || '';
  if (type === 'folder' || /\/$/.test(name)) return 'folder';
  if (name.endsWith('.pdf') || type === 'application/pdf') return 'pdf';
  if (/\.(doc|docx|rtf|odt)$/.test(name) || type.includes('word')) return 'word';
  if (/\.(xls|xlsx|csv|ods)$/.test(name) || type.includes('sheet') || type.includes('excel')) return 'sheet';
  if (/\.(ppt|pptx|key)$/.test(name) || type.includes('presentation')) return 'slides';
  if (/\.(zip|rar|7z|tar|gz)$/.test(name) || type.includes('zip') || type.includes('compressed')) return 'archive';
  return 'file';
}

const GLYPHS = {
  pdf: Pdf01Icon,
  word: Doc01Icon,
  sheet: Xls01Icon,
  slides: Ppt01Icon,
  archive: Zip01Icon,
  folder: Folder01Icon,
  file: File02Icon,
};

function FileGlyph({ kind }) {
  return <HugeiconsIcon icon={GLYPHS[kind] || File02Icon} size={22} strokeWidth={1.6} />;
}

export default function Attachments({ files = [], onRemove }) {
  const ordered = [...files].sort((a, b) => Number(isImageFile(b)) - Number(isImageFile(a)));
  const images = ordered.filter(isImageFile);
  const stripRef = useRef(null);
  const [active, setActive] = useState(null);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return undefined;
    let target = strip.scrollLeft;
    let frame = 0;
    function tick() {
      const gap = target - strip.scrollLeft;
      if (Math.abs(gap) < 0.4) {
        strip.scrollLeft = target;
        frame = 0;
        return;
      }
      strip.scrollLeft += gap * 0.18;
      frame = requestAnimationFrame(tick);
    }
    function onWheel(event) {
      const max = strip.scrollWidth - strip.clientWidth;
      if (max <= 1) return;
      event.preventDefault();
      target = Math.min(max, Math.max(0, target + event.deltaY));
      if (!frame) frame = requestAnimationFrame(tick);
    }
    strip.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      strip.removeEventListener('wheel', onWheel);
      cancelAnimationFrame(frame);
    };
  }, [files.length]);

  function open(file) {
    if (!isImageFile(file)) return;
    const index = images.findIndex(item => item.id === file.id);
    setActive(index >= 0 ? index : 0);
  }

  return (
    <>
      <div className="file-row is-images" ref={stripRef}>
        {ordered.map(file => (
          isImageFile(file) ? (
            <div key={file.id} className="file-thumb">
              <button type="button" className="file-thumb-hit" onClick={() => open(file)} aria-label={`Open ${file.name}`}>
                <img src={file.url} alt="" />
              </button>
              <button type="button" className="file-x" aria-label={`Remove ${file.name}`} onClick={() => onRemove?.(file.id)}>
                <X size={12} strokeWidth={2.25} />
              </button>
            </div>
          ) : (
            <div key={file.id} className="file-card">
              <span className={`file-kind is-${kindOf(file)}`} aria-hidden="true">
                <FileGlyph kind={kindOf(file)} />
              </span>
              <span className="file-card-copy">
                <strong>{file.name}</strong>
                <small>{formatFileSize(file.size)}</small>
              </span>
              <button type="button" className="file-x" aria-label={`Remove ${file.name}`} onClick={() => onRemove?.(file.id)}>
                <X size={12} strokeWidth={2.25} />
              </button>
            </div>
          )
        ))}
      </div>
      {active != null ? (
        <ImageLightbox
          images={images}
          index={active}
          onIndex={setActive}
          onClose={() => setActive(null)}
        />
      ) : null}
    </>
  );
}

function ImageLightbox({ images, index, onIndex, onClose }) {
  const [shown, setShown] = useState(false);
  const image = images[index];

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    function onKey(event) {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') onIndex((index + 1) % images.length);
      if (event.key === 'ArrowLeft') onIndex((index - 1 + images.length) % images.length);
    }
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey);
    };
  }, [index, images.length, onClose, onIndex]);

  if (!image || typeof document === 'undefined') return null;

  return createPortal(
    <div className={`image-lightbox${shown ? ' is-open' : ''}`} role="dialog" aria-modal="true" aria-label={image.name} onMouseDown={onClose}>
      <ModalClose label="Close images" onMouseDown={event => event.stopPropagation()} onClick={onClose} />
      {images.length > 1 ? (
        <button type="button" className="image-lightbox-nav is-prev" aria-label="Previous image" onMouseDown={event => event.stopPropagation()} onClick={() => onIndex((index - 1 + images.length) % images.length)}>
          <ChevronLeft size={22} strokeWidth={1.75} />
        </button>
      ) : null}
      <figure onMouseDown={event => event.stopPropagation()}>
        <img key={image.id} src={image.url} alt={image.name} />
      </figure>
      {images.length > 1 ? (
        <button type="button" className="image-lightbox-nav is-next" aria-label="Next image" onMouseDown={event => event.stopPropagation()} onClick={() => onIndex((index + 1) % images.length)}>
          <ChevronRight size={22} strokeWidth={1.75} />
        </button>
      ) : null}
      <div className="image-lightbox-strip" onMouseDown={event => event.stopPropagation()}>
        {images.map((item, itemIndex) => (
          <button
            key={item.id}
            type="button"
            className={itemIndex === index ? 'is-on' : ''}
            aria-label={item.name}
            aria-current={itemIndex === index ? 'true' : undefined}
            onClick={() => onIndex(itemIndex)}
          >
            <img src={item.url} alt="" />
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
