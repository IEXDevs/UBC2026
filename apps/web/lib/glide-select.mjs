export function glideRowAt(clientY, { top, bottom, scrollTop = 0, step, count }) {
  if (clientY < top || clientY >= bottom) return null;
  const index = Math.floor((clientY - top + scrollTop) / step);
  return index >= 0 && index < count ? index : null;
}
