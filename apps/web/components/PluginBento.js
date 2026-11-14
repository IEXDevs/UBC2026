'use client';

import { useMemo, useState } from 'react';
import { motion, useSpring } from 'motion/react';

const SPANS = ['is-wide is-tall', 'is-wide', '', '', '', 'is-wide'];

function Tile({ item, index, motionOn, onToggle }) {
  const [hot, setHot] = useState(false);
  const [ripples, setRipples] = useState(0);
  const rx = useSpring(0, { stiffness: 220, damping: 22 });
  const ry = useSpring(0, { stiffness: 220, damping: 22 });
  const shiftX = useSpring(0, { stiffness: 260, damping: 24 });
  const shiftY = useSpring(0, { stiffness: 260, damping: 24 });
  const specks = useMemo(
    () => Array.from({ length: 10 }, (_, i) => ({
      id: i,
      left: 8 + ((i * 37) % 84),
      delay: (i % 5) * 0.18,
      duration: 1.6 + (i % 4) * 0.25,
    })),
    [],
  );

  function move(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    event.currentTarget.style.setProperty('--mx', `${px}px`);
    event.currentTarget.style.setProperty('--my', `${py}px`);
    if (!motionOn) return;
    const nx = px / rect.width - 0.5;
    const ny = py / rect.height - 0.5;
    ry.set(nx * 7);
    rx.set(ny * -7);
    shiftX.set(nx * 8);
    shiftY.set(ny * 8);
  }

  function leave() {
    rx.set(0);
    ry.set(0);
    shiftX.set(0);
    shiftY.set(0);
    setHot(false);
  }

  return (
    <motion.button
      type="button"
      className={`bento-tile ${SPANS[index % SPANS.length]}${item.linked ? ' is-on' : ''}`}
      style={motionOn ? { rotateX: rx, rotateY: ry, x: shiftX, y: shiftY } : undefined}
      initial={motionOn ? { opacity: 0, y: 28 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.045, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      onMouseEnter={() => setHot(true)}
      onMouseMove={move}
      onMouseLeave={leave}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty('--mx', `${event.clientX - rect.left}px`);
        event.currentTarget.style.setProperty('--my', `${event.clientY - rect.top}px`);
        setRipples(count => count + 1);
        onToggle(item);
      }}
      aria-pressed={item.linked}
      disabled={item.builtin}
    >
      <span className="bento-spot" />
      <span className="bento-edge" />
      {hot && motionOn ? specks.map(speck => (
        <span
          key={speck.id}
          className="bento-speck"
          style={{ left: `${speck.left}%`, animationDelay: `${speck.delay}s`, animationDuration: `${speck.duration}s` }}
        />
      )) : null}
      <span key={ripples} className={ripples ? 'bento-wave' : 'bento-wave is-idle'} />
      <span className="bento-copy">
        <small>{item.category || 'Plugin'}{item.linked ? ' · on' : ''}</small>
        <strong>{item.name}</strong>
        <span>{item.detail}</span>
      </span>
    </motion.button>
  );
}

export default function PluginBento({ items, motionOn, onToggle }) {
  return (
    <div className="plugin-bento">
      {items.map((item, index) => (
        <Tile key={item.id} item={item} index={index} motionOn={motionOn} onToggle={onToggle} />
      ))}
    </div>
  );
}
