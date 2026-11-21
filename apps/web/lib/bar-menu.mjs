/**
 * One entry-bar menu at a time.
 * Asking for the menu that is already open closes it.
 * A typed `/` or `@` token takes the slot and closes the others.
 */
export function exclusiveBarMenu(active, request) {
  if (request === 'token' || request === 'model' || request === 'context') return request;
  return active === request ? null : request;
}

export function menuViewportShift(center, width, viewportWidth) {
  const gutter = 8;
  const left = center - width / 2;
  const maxLeft = Math.max(gutter, viewportWidth - width - gutter);
  return Math.min(maxLeft, Math.max(gutter, left)) - left;
}
