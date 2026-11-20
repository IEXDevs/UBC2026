'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { chartLayout, formatCandleTime, formatTokenPrice, nearestCoord } from '../lib/token-market.mjs';

const EASE = [0.22, 1, 0.36, 1];

function seriesKey(points, range) {
  if (!points.length) return `${range}:empty`;
  const first = points[0];
  const last = points[points.length - 1];
  return `${range}:${points.length}:${first.t}:${last.t}:${last.price}`;
}

export default function TokenChart({ points = [], range = '1D' }) {
  const frame = useRef(null);
  const [hover, setHover] = useState(null);
  const width = 640;
  const height = 180;
  const layout = chartLayout(points, width, height);
  const stroke = layout?.up ? '#3dbe6a' : '#e10600';
  const fill = layout?.up ? 'rgba(61, 190, 106, 0.16)' : 'rgba(225, 6, 0, 0.12)';
  const key = seriesKey(points, range);

  useEffect(() => {
    setHover(null);
  }, [key]);

  function move(event) {
    if (!layout || !frame.current) return;
    const rect = frame.current.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * width;
    setHover(nearestCoord(layout.coords, x));
  }

  return (
    <div
      className="token-chart"
      ref={frame}
      onMouseMove={move}
      onMouseLeave={() => setHover(null)}
    >
      <AnimatePresence mode="wait" initial={false}>
        {layout ? (
          <motion.svg
            key={key}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="Token price"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE }}
          >
            <motion.path
              d={layout.area}
              fill={fill}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, ease: EASE }}
            />
            <motion.path
              d={layout.d}
              fill="none"
              stroke={stroke}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.5, ease: EASE }}
            />
            {hover ? (
              <>
                <line x1={hover.x} x2={hover.x} y1="8" y2={height - 8} stroke="#3a3a3a" />
                <circle cx={hover.x} cy={hover.y} r="4" fill={stroke} />
              </>
            ) : null}
          </motion.svg>
        ) : (
          <motion.div
            key={key}
            className="price-graph-empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE }}
          />
        )}
      </AnimatePresence>
      {hover ? (
        <p className="token-tip">
          <strong>{formatTokenPrice(hover.price)}</strong>
          <span>{formatCandleTime(hover.t, range)}</span>
        </p>
      ) : null}
    </div>
  );
}
