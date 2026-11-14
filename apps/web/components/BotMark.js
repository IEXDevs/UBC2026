import { SHAPE_PATHS } from '../lib/bot-look.mjs';

const EYE_Y = {
  triangle: 34,
  diamond: 25,
  pill: 25,
};

export default function BotMark({ shape = 'circle', color = '#7c5cff', size = 36 }) {
  const y = EYE_Y[shape] ?? 24;
  return (
    <svg className={`mark mark-${shape}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <path d={SHAPE_PATHS[shape] ?? SHAPE_PATHS.circle} fill={color} />
      <rect x="23" y={y} width="6" height="14" rx="3" fill="#140c22" />
      <rect x="35" y={y} width="6" height="14" rx="3" fill="#140c22" />
    </svg>
  );
}
