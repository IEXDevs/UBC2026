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
    node.setAttribute('aria-hidden', 'true');
    node.style.position = 'fixed';
    node.style.top = '0';
    node.style.left = '0';
    node.style.width = '1px';
    node.style.height = '1px';
    node.style.opacity = '0.01';
    node.style.border = 'none';
    node.style.padding = '0';
    doc.body.appendChild(node);
    if (typeof node.focus === 'function') node.focus();
    node.select();
    if (typeof node.setSelectionRange === 'function') node.setSelectionRange(0, value.length);
    const ok = typeof doc.execCommand === 'function' ? doc.execCommand('copy') : false;
    node.remove();
    return ok === true;
  } catch {
    return false;
  }
}
