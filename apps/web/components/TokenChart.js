'use client';

import { useRef, useState } from 'react';
import { chartLayout, formatCandleTime, formatTokenPrice, nearestCoord } from '../lib/token-market.mjs';

export default function TokenChart({ points = [], range = '1D' }) {
  const frame = useRef(null);
  const [hover, setHover] = useState(null);
  const width = 640;
  const height = 180;
  const layout = chartLayout(points, width, height);
  const stroke = layout?.up ? '#3dbe6a' : '#e10600';
  const fill = layout?.up ? 'rgba(61, 190, 106, 0.16)' : 'rgba(225, 6, 0, 0.12)';

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
      {layout ? (
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Token price">
          <path d={layout.area} fill={fill} />
          <path d={layout.d} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {hover ? (
            <>
              <line x1={hover.x} x2={hover.x} y1="8" y2={height - 8} stroke="#3a3a3a" />
              <circle cx={hover.x} cy={hover.y} r="4" fill={stroke} />
            </>
          ) : null}
        </svg>
      ) : <div className="price-graph-empty" />}
      {hover ? (
        <p className="token-tip">
          <strong>{formatTokenPrice(hover.price)}</strong>
          <span>{formatCandleTime(hover.t, range)}</span>
        </p>
      ) : null}
    </div>
  );
}
