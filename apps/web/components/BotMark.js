'use client';

import { useId } from 'react';
import { SHAPE_PATHS } from '../lib/bot-look.mjs';

export default function BotMark({ shape = 'circle', color = '#7c5cff', size = 36, image = '' }) {
  const path = SHAPE_PATHS[shape] ?? SHAPE_PATHS.circle;
  const clip = `mark-${useId().replace(/:/g, '')}`;
  return (
    <svg className={`mark mark-${shape}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      {image ? (
        <>
          <defs>
            <clipPath id={clip}>
              <path d={path} />
            </clipPath>
          </defs>
          <image href={image} x="0" y="0" width="64" height="64" preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clip})`} />
        </>
      ) : (
        <>
          <path d={path} fill={color} />
          <rect x="23" y="24" width="6" height="14" rx="3" fill="#140c22" />
          <rect x="35" y="24" width="6" height="14" rx="3" fill="#140c22" />
        </>
      )}
    </svg>
  );
}
