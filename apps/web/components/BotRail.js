'use client';

import { useRef, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { PencilEdit01Icon } from '@hugeicons/core-free-icons';
import { cardLoopReport } from '@ubc2026/contracts/card-loop';
import Dock from './Dock';
import AnimatedList from './AnimatedList';
import BotMark from './BotMark';
import AgentEdit, { readAgentImage } from './AgentEdit';
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

function agentIcon(bot, size, onPhoto) {
  const running = bot.loop?.active && !bot.loopPaused && !bot.frozen && bot.enabled !== false && bot.status !== 'paused';
  return (
    <span className={running ? 'agent-mark agent-loop-picture' : 'agent-mark'} style={{ width: size, height: size }}>
      <BotMark shape={bot.shape} color={bot.color} image={bot.image} name={bot.name} size={size} />
      {statusMark(bot.status)}
      <button
        type="button"
        className="agent-pencil"
        aria-label={`Change photo for ${bot.name}`}
        onClick={(event) => {
          event.stopPropagation();
          onPhoto(bot);
        }}
      >
        <HugeiconsIcon icon={PencilEdit01Icon} size={13} color="#ffffff" strokeWidth={2.25} />
      </button>
    </span>
  );
}

function loopMark(bot, onBreak) {
  const loop = bot?.loop;
  if (!loop || loop.active !== true || typeof loop.cooldownLabel !== 'string' || !loop.cooldownLabel) return null;
  const label = loop.cooldownLabel;
  const purpose = typeof loop.purpose === 'string' ? loop.purpose : '';
  const report = cardLoopReport(loop);
  const title = [
    purpose,
    report ? new Date(report.at).toLocaleString() + ' · ' + report.summary : '',
    'Break loop',
  ].filter(Boolean).join('\n');
  return (
    <button
      type="button"
      className="agent-loop"
      aria-label={['Loop every ' + label + '.', purpose, report?.summary, 'Break loop.'].filter(Boolean).join(' ')}
      title={title}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onBreak?.(bot.id);
      }}
    >
      {label}
    </button>
  );
}

function blockNativeMenu(event) {
  event.preventDefault();
}

function placeMenu(event) {
  return { x: event.clientX, y: event.clientY };
}

export default function BotRail({ bots, activeId, canDrag, collapsed, onSelect, onReorder, onDelete, onEdit, onCreate, onBreakLoop }) {
  const activeIndex = bots.findIndex(bot => bot.id === activeId);
  const [menu, setMenu] = useState(null);
  const fileRef = useRef(null);
  const photoBot = useRef(null);
  const closeMenu = () => setMenu(null);
  const editing = menu ? bots.find(item => item.id === menu.id) : null;

  function startPhoto(bot) {
    photoBot.current = bot;
    if (fileRef.current) {
      fileRef.current.value = '';
      fileRef.current.click();
    }
  }

  async function onPhoto(event) {
    const bot = photoBot.current;
    const next = await readAgentImage(event.target.files?.[0]);
    event.target.value = '';
    if (!bot || !next) return;
    onEdit(bot.id, { name: bot.name, color: bot.color, shape: bot.shape, image: next });
  }

  const photoInput = (
    <input ref={fileRef} className="agent-file" type="file" accept="image/*" tabIndex={-1} aria-hidden="true" onChange={onPhoto} />
  );

  if (bots.length === 0) {
    return <div className="rail" />;
  }

  if (collapsed) {
    const items = bots.map((bot, index) => {
      const mark = loopMark(bot, onBreakLoop);
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
      rows.push({ label: 'Edit', onClick: () => setMenu({ id: bot.id, x: 88, y: 80 + index * 48 }) });
      return {
        icon: agentIcon(bot, 54, startPhoto),
        label: bot.name,
        ...(mark ? { badge: mark } : {}),
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
        {editing ? <AgentEdit bot={editing} x={menu.x} y={menu.y} onClose={closeMenu} onSave={onEdit} onDelete={onDelete} /> : null}
        {photoInput}
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
          icon: agentIcon(bot, 60, startPhoto),
          title: bot.name,
          description: bot.currentTask || bot.goal,
          meta: loopMark(bot, onBreakLoop),
        }))}
        onItemSelect={item => onSelect(item.id)}
        onItemContextMenu={(item, _index, event) => {
          const spot = placeMenu(event);
          setMenu({ id: item.id, name: item.title, ...spot });
        }}
      />
      {editing ? <AgentEdit bot={editing} x={menu.x} y={menu.y} onClose={closeMenu} onSave={onEdit} onDelete={onDelete} /> : null}
      {photoInput}
    </div>
  );
}
