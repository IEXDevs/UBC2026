/**
 * Copy a string in the browser. Clipboard API first, then a hidden textarea.
 * Callers never log the value.
 */

export async function copyText(value, io = globalThis) {
  if (typeof value !== 'string' || !value) return false;
  const clipboard = io.navigator?.clipboard;
  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(value);
      return true;
    } catch {
      // Permissions Policy, iframe, or a missing user gesture.
    }
  }
  const doc = io.document;
  if (!doc?.body || typeof doc.createElement !== 'function') return false;
  try {
    const node = doc.createElement('textarea');
    node.value = value;
    node.setAttribute('readonly', '');
    node.style.position = 'fixed';
    node.style.left = '-9999px';
    doc.body.appendChild(node);
    node.select();
    const ok = typeof doc.execCommand === 'function' ? doc.execCommand('copy') : false;
    node.remove();
    return ok === true;
  } catch {
    return false;
  }
}
