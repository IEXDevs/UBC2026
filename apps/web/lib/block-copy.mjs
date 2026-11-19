/** Stops a selection copy. Copy buttons write through the clipboard API, not this event. */
export function blockCopy(event) {
  event.preventDefault();
}
