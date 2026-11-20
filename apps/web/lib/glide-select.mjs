export function glideRowAt(clientY, { top, scrollTop = 0, padding = 4, step, count }) {
  const index = Math.floor((clientY - top + scrollTop - padding) / step);
  return index >= 0 && index < count ? index : null;
}
