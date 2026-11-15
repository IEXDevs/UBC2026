/**
 * The expanded permissions menu (Ask every time, Review by AI, Full permissions)
 * stays open until a pointer lands outside it. A press on an option stays inside
 * so that click can select the permission and close.
 */
export function shouldClosePermitMenu(open, target, menuRoot) {
  if (!open) return false;
  if (menuRoot && typeof menuRoot.contains === 'function' && menuRoot.contains(target)) return false;
  return true;
}
