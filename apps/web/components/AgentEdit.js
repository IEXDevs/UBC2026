'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil } from 'lucide-react';
import { BOT_COLORS } from '../lib/bot-look.mjs';
import BotMark from './BotMark';
import HoldButton from './HoldButton';

function placePanel(x, y) {
  const width = 280;
  const height = 360;
  return {
    x: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
    y: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
  };
}

export function AgentPhoto({ shape, color, image, size, onImage, label = 'Change photo' }) {
  const inputRef = useRef(null);
  return (
    <div className="agent-photo" style={{ width: size, height: size }}>
      <BotMark shape={shape} color={color} image={image} size={size} />
      <button type="button" className="agent-pencil" aria-label={label} onClick={() => inputRef.current?.click()}>
        <Pencil size={size > 80 ? 16 : 13} strokeWidth={1.75} />
      </button>
      <input
        ref={inputRef}
        className="agent-file"
        type="file"
        accept="image/*"
        tabIndex={-1}
        onChange={async (event) => {
          const next = await readAgentImage(event.target.files?.[0]);
          event.target.value = '';
          if (next) onImage(next);
        }}
      />
    </div>
  );
}

export function readAgentImage(file) {
  return new Promise((resolve) => {
    if (!file || !file.type?.startsWith('image/')) {
      resolve('');
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 128;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve('');
    };
    img.src = url;
  });
}

export default function AgentEdit({ bot, x, y, onClose, onSave, onDelete }) {
  const spot = placePanel(x, y);
  const [name, setName] = useState(bot.name);
  const [color, setColor] = useState(bot.color);
  const [image, setImage] = useState(bot.image || '');

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    function onPointer(event) {
      if (!event.target.closest?.('.agent-edit')) onClose();
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [onClose]);

  function commit(patch) {
    onSave(bot.id, { name, color, image, shape: bot.shape, ...patch });
  }

  return createPortal(
    <form
      className="agent-edit"
      style={{ left: spot.x, top: spot.y }}
      onSubmit={(event) => {
        event.preventDefault();
        commit({});
        onClose();
      }}
      onMouseDown={event => event.stopPropagation()}
    >
      <div className="agent-edit-head">
        <AgentPhoto shape={bot.shape} color={color} image={image} size={48} onImage={setImage} />
        <input aria-label="Agent name" value={name} maxLength={64} onChange={event => setName(event.target.value)} />
      </div>
      <div className="swatches" role="listbox" aria-label="Agent color">
        {BOT_COLORS.map(swatch => (
          <button
            key={swatch.id}
            type="button"
            className={swatch.value === color ? 'is-on' : ''}
            style={{ background: swatch.value }}
            aria-label={swatch.id}
            aria-pressed={swatch.value === color}
            onClick={() => setColor(swatch.value)}
          />
        ))}
      </div>
      {image ? <button type="button" className="ghost" onClick={() => setImage('')}>Remove photo</button> : null}
      <div className="agent-edit-actions">
        <button type="submit" className="solid" disabled={!name.trim()}>Save</button>
        <HoldButton
          doneLabel="Deleted"
          backgroundColor="#27272a"
          fillColor="#5227FF"
          textColor="#f5f5f5"
          fillTextColor="#ffffff"
          size="md"
          radius={14}
          fillDirection="right"
          holdTime={2000}
          releaseTime={200}
          pressScale={0.97}
          onHold={() => {
            onDelete(bot.id);
            onClose();
          }}
        >
          Hold to delete
        </HoldButton>
      </div>
    </form>,
    document.body,
  );
}
