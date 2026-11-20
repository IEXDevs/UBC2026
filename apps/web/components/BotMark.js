'use client';

import { useId } from 'react';

function initial(name) {
  const letter = String(name || '').trim().charAt(0).toUpperCase();
  return letter || 'A';
}

/** Color tile with the agent's initial. Photos stay in the same rounded tile. */
export default function BotMark({ color = '#7c5cff', size = 36, image = '', name = '' }) {
  const clip = `mark-${useId().replace(/:/g, '')}`;
  return (
    <svg className="mark mark-tile" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <rect x="4" y="4" width="56" height="56" rx="18" />
        </clipPath>
      </defs>
      {image ? (
        <image href={image} x="4" y="4" width="56" height="56" preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clip})`} />
      ) : (
        <>
          <rect x="4" y="4" width="56" height="56" rx="18" fill={color} />
          <text
            x="32"
            y="41"
            textAnchor="middle"
            fill="#140c22"
            fontSize="26"
            fontWeight="650"
            fontFamily="ui-sans-serif, system-ui, sans-serif"
          >
            {initial(name)}
          </text>
        </>
      )}
    </svg>
  );
}
