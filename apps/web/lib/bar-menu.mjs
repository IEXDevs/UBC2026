/**
 * One entry-bar menu at a time.
 * Asking for the menu that is already open closes it.
 * A typed `/` or `@` token takes the slot and closes the others.
 */
export function exclusiveBarMenu(active, request) {
  if (request === 'token' || request === 'model' || request === 'context') return request;
  return active === request ? null : request;
}
