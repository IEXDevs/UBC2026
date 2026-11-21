'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'motion/react';
import { HOLDING_PALETTE } from '../lib/position-bubbles.mjs';
import { SPRITE_RADIUS } from '../lib/position-bubble-sprites.mjs';

function HoldingTooltip({ id, bubble, anchor, unpriced }) {
  const box = useRef(null);
  useLayoutEffect(() => {
    let frame = 0;
    function place() {
      const element = box.current;
      if (!element || !anchor.isConnected) return;
      const rect = anchor.getBoundingClientRect();
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      const x = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + (rect.width - width) / 2));
      const above = rect.top - height - 8;
      const y = above >= 8 ? above : Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - height - 8));
      element.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      frame = requestAnimationFrame(place);
    }
    place();
    return () => cancelAnimationFrame(frame);
  }, [anchor]);

  return createPortal(
    <div id={id} ref={box} className="book-holding-tooltip" role="tooltip">
      <div><strong>{bubble.asset}</strong><b>{bubble.valueLabel}</b></div>
      <div><span>{bubble.amountLabel}</span><small>{bubble.shareLabel} of {unpriced ? 'priced holdings' : 'wallet'}</small></div>
    </div>, document.body,
  );
}

export default function PositionWalletBubbles({ wallet, sprites }) {
  const id = useId();
  const reduce = useReducedMotion();
  const [active, setActive] = useState(null);
  const selected = wallet.bubbles.find(bubble => bubble.id === active?.id);
  const transition = { duration: reduce ? 0 : 0.26, ease: 'easeOut' };

  useEffect(() => {
    if (!active) return;
    function outside(event) {
      if (!active.anchor.contains(event.target)) setActive(null);
    }
    function escape(event) {
      if (event.key === 'Escape') setActive(null);
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [active]);

  function show(bubble, anchor, pinned = false) {
    setActive(current => current?.id === bubble.id && current.pinned
      ? (pinned ? null : current)
      : { id: bubble.id, anchor, pinned });
  }

  function hide(bubble) {
    setActive(current => current?.id === bubble.id && !current.pinned ? null : current);
  }

  function moveSheen(event) {
    if (reduce || event.pointerType === 'touch') return;
    const svg = event.currentTarget;
    const box = svg.getBoundingClientRect();
    const x = ((event.clientX - box.left) / Math.max(box.width, 1) - 0.5) * 4;
    const y = ((event.clientY - box.top) / Math.max(box.height, 1) - 0.5) * 4;
    svg.style.setProperty('--book-pointer-x', `${x}px`);
    svg.style.setProperty('--book-pointer-y', `${y}px`);
  }

  return (
    <>
      <svg
        className="book-wallet-bubbles"
        viewBox={`0 0 ${wallet.bubbleWidth} ${wallet.bubbleHeight}`}
        role="group"
        aria-label={wallet.bubbles.map(bubble => `${bubble.asset} ${bubble.valueLabel}`).join(', ')}
        onPointerMove={moveSheen}
        onPointerLeave={event => {
          event.currentTarget.style.removeProperty('--book-pointer-x');
          event.currentTarget.style.removeProperty('--book-pointer-y');
        }}
      >
        <defs>
          <radialGradient id={`${id}-sheen`}>
            <stop stopColor="#eef8ff" stopOpacity="0.54" />
            <stop offset="100%" stopColor="#eef8ff" stopOpacity="0" />
          </radialGradient>
          {!sprites?.length && HOLDING_PALETTE.map(([light, core, deep], index) => (
            <radialGradient key={core} id={`${id}-${index}`} cx="36%" cy="27%" r="76%">
              <stop stopColor={light} />
              <stop offset="52%" stopColor={core} />
              <stop offset="100%" stopColor={deep} />
            </radialGradient>
          ))}
        </defs>
        {wallet.bubbles.map(bubble => {
          const { x, y, r } = bubble;
          const isActive = selected?.id === bubble.id;
          const sprite = sprites?.[bubble.hue];
          const extent = r * SPRITE_RADIUS;
          const label = [bubble.asset, bubble.valueLabel, bubble.amountLabel, bubble.shareLabel].filter(Boolean).join(' · ');
          return (
            <motion.g key={bubble.id} initial={false} animate={{ opacity: selected && !isActive ? 0.68 : 1 }} transition={transition}>
              {sprite ? (
                <motion.image
                  className="book-wallet-sprite"
                  href={sprite}
                  aria-hidden="true"
                  initial={false}
                  animate={{ attrX: x - extent, attrY: y - extent, width: extent * 2, height: extent * 2 }}
                  transition={transition}
                />
              ) : null}
              <motion.circle
                className="book-wallet-bubble"
                data-active={isActive ? '' : undefined}
                tabIndex={0}
                role="button"
                aria-label={label}
                aria-describedby={isActive ? `${id}-details` : undefined}
                initial={false}
                animate={{ cx: x, cy: y, r }}
                transition={transition}
                fill={sprite ? 'transparent' : `url(#${id}-${bubble.hue})`}
                onPointerEnter={event => {
                  if (event.pointerType !== 'touch') show(bubble, event.currentTarget);
                }}
                onPointerLeave={() => hide(bubble)}
                onFocus={event => show(bubble, event.currentTarget)}
                onBlur={() => hide(bubble)}
                onClick={event => show(bubble, event.currentTarget, true)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    show(bubble, event.currentTarget, true);
                  }
                }}
              >
                {!isActive && <title>{label}</title>}
              </motion.circle>
              {r > 7 && <g className="book-wallet-sheen" aria-hidden="true">
                <motion.ellipse
                  initial={false}
                  animate={{ cx: x - r * 0.29, cy: y - r * 0.42, rx: r * 0.37, ry: r * 0.18 }}
                  transition={transition}
                  fill={`url(#${id}-sheen)`}
                />
              </g>}
              {r * 2 >= bubble.asset.length * 5 + 7 && (
                <motion.text initial={false} animate={{ attrX: x, attrY: y }} transition={transition}>{bubble.asset}</motion.text>
              )}
            </motion.g>
          );
        })}
      </svg>
      {selected && <HoldingTooltip id={`${id}-details`} bubble={selected} anchor={active.anchor} unpriced={wallet.unpriced} />}
    </>
  );
}
