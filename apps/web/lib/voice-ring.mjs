/**
 * Volume ticks around the talk orb.
 * Angles are CSS degrees: 0 is up, clockwise is positive.
 * The arc starts at the lower left, crosses the top, and ends at the lower right.
 */

export const RING_TICKS = 100;
export const RING_SWEEP = 300;
export const RING_START = -RING_SWEEP / 2;

const wrap = (angle) => ((angle % 360) + 360) % 360;

export function tickAngle(index, ticks = RING_TICKS) {
  if (ticks <= 1) return RING_START;
  return RING_START + (index / (ticks - 1)) * RING_SWEEP;
}

export function pointerAngle(dx, dy) {
  return (Math.atan2(dx, -dy) * 180) / Math.PI;
}

/** 0–100 along the arc, or null when the pointer is in the bottom gap. */
export function sweepPosition(angle) {
  if (!Number.isFinite(angle)) return null;
  const rel = wrap(angle - RING_START);
  if (rel > RING_SWEEP) return null;
  return (rel / RING_SWEEP) * 100;
}

export function angleDelta(a, b) {
  const d = Math.abs(wrap(a) - wrap(b));
  return Math.min(d, 360 - d);
}

export function hoverLift(tick, pointer, { reach = 28, near = true } = {}) {
  if (!near || !Number.isFinite(pointer) || !Number.isFinite(tick)) return 0;
  const distance = angleDelta(tick, pointer);
  if (distance >= reach) return 0;
  const falloff = Math.cos((Math.PI * distance) / (2 * reach));
  return falloff * falloff;
}

export function bandEnergy(bins, index, ticks = RING_TICKS) {
  if (!bins || bins.length === 0 || ticks <= 1) return 0;
  const last = bins.length - 1;
  const pos = (index / (ticks - 1)) ** 1.55 * last;
  const i0 = Math.floor(pos);
  const i1 = Math.min(last, i0 + 1);
  const mix = pos - i0;
  const sample = (Number(bins[i0]) * (1 - mix) + Number(bins[i1]) * mix) / 255;
  if (!Number.isFinite(sample)) return 0;
  return Math.max(0, Math.min(1, sample));
}

export function tickScale({ energy = 0, hover = 0, filled = 0, head = 0, trail = 0 } = {}) {
  return 0.22 + energy * 0.9 + hover * 1.15 + filled * 0.16 + head * 0.42 + trail * 0.28;
}

export function tickAlpha({ energy = 0, hover = 0, filled = 0, head = 0, trail = 0 } = {}) {
  return Math.max(0, Math.min(1, 0.18 + energy * 0.72 + hover * 0.3 + filled * 0.22 + head * 0.4 + trail * 0.5));
}
