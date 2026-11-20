export const DOCK_EXPAND_MS = 640;
export const DOCK_SWITCH_MS = 2000;

export function dockCollapseDelay(now, openedAt, duration = DOCK_EXPAND_MS) {
  if (!Number.isFinite(openedAt) || openedAt <= 0) return duration;
  return Math.max(0, duration - (now - openedAt));
}

export function dockHoldDelay(now, openedAt, switchUntil = 0, duration = DOCK_EXPAND_MS) {
  const expandLeft = dockCollapseDelay(now, openedAt, duration);
  const switchLeft = Number.isFinite(switchUntil) && switchUntil > 0 ? Math.max(0, switchUntil - now) : 0;
  return Math.max(expandLeft, switchLeft);
}

export function pillAnchor(shellWidth, side, detail) {
  const width = Number.isFinite(shellWidth) ? shellWidth : 0;
  const sideW = Number.isFinite(side) ? Math.max(0, side) : 0;
  const detailW = Number.isFinite(detail) ? Math.max(0, detail) : 0;
  const span = Math.max(0, width - sideW - detailW);
  return sideW + span / 2;
}

export function dockShouldStayOpen(inside, elapsed, duration = DOCK_EXPAND_MS, switchLeft = 0) {
  if (inside) return true;
  if (switchLeft > 0) return true;
  return elapsed < duration;
}
