'use client';

import Dock from './Dock';
import AnimatedList from './AnimatedList';
import BotMark from './BotMark';
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

export default function BotRail({ bots, activeId, canDrag, collapsed, onSelect, onReorder, onCreate }) {
  const activeIndex = bots.findIndex(bot => bot.id === activeId);

  if (bots.length === 0) {
    if (collapsed) return null;
    return (
      <button type="button" className="empty-rail" onClick={onCreate}>
        Make your first Agent!
      </button>
    );
  }

  if (collapsed) {
    const items = bots.map((bot, index) => ({
      icon: agentIcon(bot, 54),
      label: bot.name,
      active: bot.id === activeId,
      onClick: () => onSelect(bot.id),
      menu: canDrag
        ? [
            {
              label: 'Move up',
              disabled: index === 0,
              onClick: () => onReorder(bot.id, bots[index - 1].id),
            },
            {
              label: 'Move down',
              disabled: index === bots.length - 1,
              onClick: () => onReorder(bot.id, bots[index + 1].id),
            },
          ]
        : undefined,
    }));

    return (
      <div className="rail rail-squares" role="navigation" aria-label="Agents">
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
      </div>
    );
  }

  return (
    <div className="rail" role="navigation" aria-label="Agents">
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
      />
    </div>
  );
}
