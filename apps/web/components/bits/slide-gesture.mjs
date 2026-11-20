export function slideOffset(drag, clientX) {
  const distance = (clientX - drag.x) / drag.scale;
  return Math.min(drag.max, Math.max(0, drag.origin + distance));
}

export function slideReady(offset, max) {
  return max > 0 && offset >= max * 0.9;
}

export function slideConfirmed(drag, event) {
  return event.type === 'pointerup'
    && event.pointerId === drag.id
    && slideReady(slideOffset(drag, event.clientX), drag.max);
}
