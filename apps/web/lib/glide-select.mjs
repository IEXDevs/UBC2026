export function glideRowAt({ x, y }, { top, bottom, left, right, scrollTop = 0, step, count }) {
  if (x < left || x >= right || y < top || y >= bottom) return null;
  const index = Math.floor((y - top + scrollTop) / step);
  return index >= 0 && index < count ? index : null;
}
