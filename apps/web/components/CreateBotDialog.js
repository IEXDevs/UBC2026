'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { BOT_COLORS, randomShape } from '../lib/bot-look.mjs';
import { draftBot } from '../lib/roster.mjs';
import { readAgentImage } from './AgentEdit';
import BotMark from './BotMark';
import { usePresence } from './usePresence';

export default function CreateBotDialog({ open, onClose, onCreate }) {
  const { mounted, leaving } = usePresence(open);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#7c5cff');
  const [image, setImage] = useState('');
  const [shape, setShape] = useState('circle');

  useEffect(() => {
    if (!open) return undefined;
    setName('');
    setColor('#7c5cff');
    setImage('');
    setShape(randomShape());
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  function submit(event) {
    event.preventDefault();
    const bot = draftBot({ name, shape, color });
    if (!bot) return;
    onCreate({ ...bot, image });
  }

  return (
    <div className={`backdrop is-center ${leaving ? 'is-leaving' : ''}`} onMouseDown={onClose}>
      <form
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-agent-title"
        onMouseDown={event => event.stopPropagation()}
        onSubmit={submit}
      >
        <div className="sheet-head">
          <h2 id="create-agent-title">Create New Agent</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>
        <div className="bot-preview">
          <BotMark shape={shape} color={color} image={image} size={112} />
        </div>
        <input
          className="bot-name"
          value={name}
          placeholder="Name your Agent"
          aria-label="Name your Agent"
          maxLength={64}
          autoFocus
          onChange={event => setName(event.target.value)}
        />
        <label className="agent-edit-file">
          Photo
          <input
            type="file"
            accept="image/*"
            aria-label="Agent photo"
            onChange={async (event) => {
              const next = await readAgentImage(event.target.files?.[0]);
              if (next) setImage(next);
            }}
          />
        </label>
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
        <div className="sheet-actions">
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="solid" disabled={!name.trim()}>Create</button>
        </div>
      </form>
    </div>
  );
}
