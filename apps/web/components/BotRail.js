'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Dock from './Dock';
import AnimatedList from './AnimatedList';
import BotMark from './BotMark';
import HoldButton from './HoldButton';
import { listLook } from './listLook';

function statusMark(status) {
  const known = status === 'watching' || status === 'idle' || status === 'paused' || status === 'draft';
  const kind = known ? status : 'idle';
  const label = typeof status === 'string' && status ? status : 'idle';
  return (
    <span className={`agent-status is-${kind}`} title={label} aria-label={label}>
      {kind === 'paused' ? <span className="agent-pause" aria-hidden="true" /> : null}
    </span>
  );
}

function agentIcon(bot, size) {
  return (
    <span className="agent-mark" style={{ width: size, height: size }}>
      <BotMark shape={bot.shape} color={bot.color} size={size} />
      {statusMark(bot.status)}
    </span>
  );
}

function blockNativeMenu(event) {
  event.preventDefault();
}

function placeMenu(event) {
  const width = 220;
  const height = 56;
  return {
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
  };
}

function DeleteMenu({ menu, onClose, onDelete }) {
  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    function onPointer(event) {
      if (!event.target.closest?.('.agent-menu')) onClose();
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [onClose]);

  return createPortal(
    <div className="agent-menu" role="menu" aria-label={`Delete ${menu.name}`} style={{ left: menu.x, top: menu.y }}>
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
        wave
        waveAmplitude={6}
        glow
        resetAfter={1200}
        onHold={() => {
          onDelete(menu.id);
          onClose();
        }}
      >
        Hold to delete
      </HoldButton>
    </div>,
    document.body,
  );
}

export default function BotRail({ bots, activeId, canDrag, collapsed, onSelect, onReorder, onDelete, onCreate }) {
  const activeIndex = bots.findIndex(bot => bot.id === activeId);
  const [menu, setMenu] = useState(null);
  const closeMenu = () => setMenu(null);

  if (bots.length === 0) {
    if (collapsed) return null;
    return (
      <button type="button" className="empty-rail" onClick={onCreate} onContextMenu={blockNativeMenu}>
        Make your first Agent!
      </button>
    );
  }

  if (collapsed) {
    const items = bots.map((bot, index) => {
      const rows = [];
      if (canDrag) {
        rows.push(
          {
            label: 'Move up',
            disabled: index === 0,
            onClick: () => onReorder(bot.id, bots[index - 1]?.id),
          },
          {
            label: 'Move down',
            disabled: index === bots.length - 1,
            onClick: () => onReorder(bot.id, bots[index + 1]?.id),
          },
          { separator: true },
        );
      }
      rows.push({ label: 'Hold to delete', onClick: () => setMenu({ id: bot.id, name: bot.name, x: 72, y: 80 + index * 48 }) });
      return {
        icon: agentIcon(bot, 54),
        label: bot.name,
        active: bot.id === activeId,
        onClick: () => onSelect(bot.id),
        menu: rows,
      };
    });

    return (
      <div className="rail rail-squares" role="navigation" aria-label="Agents" onContextMenu={blockNativeMenu}>
        <Dock
          className="agent-dock"
          items={items}
          position="left"
          theme="dark"
          baseItemSize={64}
          magnification={64}
          distance={160}
          panelHeight={76}
          gap={10}
          roundness={0.42}
          tiles={false}
          showLabels
          showIndicators
          accentColor="#f4f4f5"
        />
        {menu ? <DeleteMenu menu={menu} onClose={closeMenu} onDelete={onDelete} /> : null}
      </div>
    );
  }

  return (
    <div className="rail" role="navigation" aria-label="Agents" onContextMenu={blockNativeMenu}>
      <AnimatedList
        key={bots.map(bot => bot.id).join('|')}
        {...listLook({
          width: '100%',
          maxHeight: 'none',
          frame: false,
          selectOnHover: false,
          initialSelectedIndex: activeIndex,
        })}
        selectedIndex={activeIndex}
        className="rail-list"
        items={bots.map(bot => ({
          id: bot.id,
          icon: agentIcon(bot, 60),
          title: bot.name,
          description: bot.goal,
        }))}
        onItemSelect={item => onSelect(item.id)}
        onItemContextMenu={(item, _index, event) => {
          const spot = placeMenu(event);
          setMenu({ id: item.id, name: item.title, ...spot });
        }}
      />
      {menu ? <DeleteMenu menu={menu} onClose={closeMenu} onDelete={onDelete} /> : null}
    </div>
  );
}
