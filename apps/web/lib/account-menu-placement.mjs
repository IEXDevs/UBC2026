export function accountMenuPlacement({ top, bottom }, viewportHeight) {
  const above = Math.max(0, top - 16);
  const below = Math.max(0, viewportHeight - bottom - 16);
  return above >= below
    ? { top: 'auto', bottom: 'calc(100% + 8px)', maxHeight: above }
    : { top: 'calc(100% + 8px)', bottom: 'auto', maxHeight: below };
}
