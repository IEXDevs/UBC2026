export const DOCK_EXPAND_MS = 520;

export function dockCollapseDelay(now, openedAt, duration = DOCK_EXPAND_MS) {
  if (!Number.isFinite(openedAt) || openedAt <= 0) return duration;
  return Math.max(0, duration - (now - openedAt));
}

export function dockShouldStayOpen(inside, elapsed, duration = DOCK_EXPAND_MS) {
  if (inside) return true;
  return elapsed < duration;
}
