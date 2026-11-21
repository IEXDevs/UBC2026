import { formatAmount } from './money-views.mjs';
import { formatShare } from './portfolio.mjs';

export const HOLDING_PALETTE = [
  ['#65dcff', '#197def', '#172a71'],
  ['#d59aff', '#9450ed', '#442182'],
  ['#63f4d3', '#10b58c', '#09443e'],
  ['#ffd482', '#ed7e26', '#742714'],
  ['#ffa2cf', '#e54184', '#721742'],
  ['#c5f272', '#70af31', '#2e591b'],
  ['#a1bbff', '#5157ec', '#222678'],
  ['#ffaaa0', '#e74f59', '#76212c'],
];

const MAX_INDIVIDUAL = 11;
const PADDING = 5;
const GAP = 4;

function hueFor(asset, id) {
  if (asset === 'SOL' || asset === 'wSOL') return 0;
  if (asset === 'USDC') return 2;
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return hash % HOLDING_PALETTE.length;
}

export function holdingUsd(value) {
  if (value > 0n && value < 10000n) return '<$0.01';
  return `$${formatAmount((value / 10000n).toString(), 2)}`;
}

function occupiedDisks(rows, previous) {
  const priced = rows.flatMap(row => {
    if (typeof row.notionalMicroUsdc !== 'string' || !/^[1-9][0-9]{0,39}$/.test(row.notionalMicroUsdc)) return [];
    const id = String(row.id ?? row.mint ?? row.asset);
    return [{
      id, asset: row.asset, value: BigInt(row.notionalMicroUsdc), hue: hueFor(row.asset, id),
      amountLabel: typeof row.amount === 'string' && Number.isInteger(row.decimals)
        ? `${formatAmount(row.amount, row.decimals)} ${row.asset}` : '',
    }];
  });
  const known = new Set(previous?.bubbles.map(bubble => bubble.id));
  priced.sort((a, b) => {
    const prior = Number(known.has(b.id)) - Number(known.has(a.id));
    return prior || (a.value === b.value ? a.id.localeCompare(b.id) : a.value > b.value ? -1 : 1);
  });
  if (priced.length <= MAX_INDIVIDUAL + 1) return priced;
  const rest = priced.splice(MAX_INDIVIDUAL);
  priced.push({
    id: 'other', asset: 'Other', hue: 6, amountLabel: `${rest.length} assets`,
    value: rest.reduce((sum, circle) => sum + circle.value, 0n),
  });
  return priced;
}

function fits({ x, y, r }, placed, width, height) {
  return x - r >= PADDING - 0.001 && x + r <= width - PADDING + 0.001
    && y - r >= PADDING - 0.001 && y + r <= height - PADDING + 0.001
    && placed.every(disk => (x - disk.x) ** 2 + (y - disk.y) ** 2 >= (r + disk.r + GAP) ** 2 - 0.001);
}

function nearestSlot(r, placed, width, height) {
  const center = { x: width / 2, y: height / 2 };
  const left = PADDING + r;
  const right = width - left;
  const top = PADDING + r;
  const bottom = height - top;
  let best = null;
  let distance = Infinity;
  function consider(x, y) {
    const point = { x: Math.max(left, Math.min(right, x)), y: Math.max(top, Math.min(bottom, y)), r };
    const score = (point.x - center.x) ** 2 + (point.y - center.y) ** 2;
    if (score < distance && fits(point, placed, width, height)) {
      best = point;
      distance = score;
    }
  }
  consider(center.x, center.y);
  if (distance === 0) return best;
  for (const disk of placed) {
    const reach = r + disk.r + GAP;
    for (let spoke = 0; spoke < 24; spoke += 1) {
      const angle = spoke * Math.PI / 12;
      consider(disk.x + Math.cos(angle) * reach, disk.y + Math.sin(angle) * reach);
    }
  }
  for (let y = top; y <= bottom + 5; y += 5) {
    for (let x = left; x <= right + 5; x += 5) consider(x, y);
  }
  return best;
}

function packAt(disks, scale, anchors, width, height) {
  const placed = [];
  for (const disk of disks) {
    const r = disk.weight * scale;
    const saved = anchors.get(disk.id);
    const spot = saved ? { ...saved, r } : nearestSlot(r, placed, width, height);
    if (!spot || (saved && !fits(spot, placed, width, height))) return null;
    placed.push({ ...disk, ...spot });
  }
  return placed;
}

function packDisks(disks, maximum, anchors, width, height) {
  const full = packAt(disks, maximum, anchors, width, height);
  if (full) return full;
  let lower = 0;
  let upper = maximum;
  let packed = null;
  for (let check = 0; check < 12; check += 1) {
    const scale = (lower + upper) / 2;
    const result = packAt(disks, scale, anchors, width, height);
    if (result) {
      packed = result;
      lower = scale;
    } else {
      upper = scale;
    }
  }
  return packed;
}

export function packHoldingBubbles(rows, width, height, previous) {
  if (Math.min(width, height) <= PADDING * 2) return [];
  const disks = occupiedDisks(rows, previous);
  if (!disks.length) return [];
  const total = disks.reduce((sum, disk) => sum + disk.value, 0n);
  const maximum = Number(disks.reduce((max, disk) => disk.value > max ? disk.value : max, 0n));
  const anchors = new Map((previous?.bubbles ?? []).map(disk => [disk.id, {
    x: previous.bubbleWidth === width ? disk.x : (disk.x / previous.bubbleWidth) * width,
    y: previous.bubbleHeight === height ? disk.y : (disk.y / previous.bubbleHeight) * height,
  }]));
  const ranked = disks.map(disk => ({ ...disk, weight: Math.sqrt(Number(disk.value) / maximum) }));
  ranked.sort((a, b) => Number(anchors.has(b.id)) - Number(anchors.has(a.id)) || b.weight - a.weight);
  const limit = (Math.min(width, height) - PADDING * 2) / 2;
  const packed = packDisks(ranked, limit, anchors, width, height)
    ?? packDisks(ranked, limit, new Map(), width, height) ?? [];
  return packed.map(({ id, asset, hue, x, y, r, amountLabel, value }) => {
    const bps = Number(value * 10000n / total);
    return { id, asset, hue, x, y, r, amountLabel, valueLabel: holdingUsd(value), shareLabel: bps === 0 ? '<0.01%' : formatShare(bps) };
  });
}
