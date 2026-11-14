'use client';

import { useState } from 'react';
import BotMark from './BotMark';

const STRIDE = 76;

export default function BotRail({ bots, activeId, canDrag, onSelect, onReorder, onCreate }) {
  const [drag, setDrag] = useState(null);
  const activeIndex = Math.max(0, bots.findIndex(bot => bot.id === activeId));

  if (bots.length === 0) {
    return (
      <button type="button" className="empty-rail" onClick={onCreate}>
        Make your first Agent!
      </button>
    );
  }

  function visualIndex(index) {
    if (!drag) return index;
    if (index === drag.from) return drag.over;
    if (drag.from < drag.over && index > drag.from && index <= drag.over) return index - 1;
    if (drag.from > drag.over && index < drag.from && index >= drag.over) return index + 1;
    return index;
  }

  function startDrag(event, index) {
    if (!canDrag || event.button !== 0) return;
    const origin = event.clientY;
    const from = index;
    let over = from;
    let active = false;
    function move(e) {
      const dy = e.clientY - origin;
      if (!active) {
        if (Math.abs(dy) < 6) return;
        active = true;
      }
      e.preventDefault();
      over = Math.max(0, Math.min(bots.length - 1, from + Math.round(dy / STRIDE)));
      setDrag({ from, over, dy });
    }
    function end() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      setDrag(null);
      if (active && over !== from) onReorder(bots[from].id, bots[over].id);
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  return (
    <div className="rail" role="listbox" aria-label="Agents" aria-activedescendant={activeId ? `bot-${activeId}` : undefined}>
      <div className="rail-glide" style={{ transform: `translateY(${visualIndex(activeIndex) * STRIDE}px)` }} />
      {bots.map((bot, index) => {
        const dragged = drag?.from === index;
        const shift = visualIndex(index) - index;
        const y = dragged ? drag.dy : shift * STRIDE;
        return (
          <div
            key={bot.id}
            id={`bot-${bot.id}`}
            role="option"
            aria-selected={bot.id === activeId}
            className={`rail-row ${dragged ? 'is-dragging' : ''}`}
            style={{ transform: `translateY(${y}px)${dragged ? ' scale(1.03)' : ''}` }}
          >
            <button
              type="button"
              className="rail-hit"
              onPointerDown={event => startDrag(event, index)}
              onClick={() => { if (!drag) onSelect(bot.id); }}
            >
              <BotMark shape={bot.shape} color={bot.color} />
              <span className="rail-copy">
                <strong>{bot.name}</strong>
                <small>{bot.goal}</small>
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
