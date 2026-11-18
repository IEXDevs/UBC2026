const MAX_NAME = 180;
// Split on a real first extension so "Untitled 3.txtmaelstrom-qa-fixture.txt" does not
// treat "txtmaels" as an 8-char extension.
const STUCK_EXTS = 'txt|md|pdf|png|jpe?g|gif|webp|docx?|csv|json|html?|jsx?|mjs|tsx?|css|zip|mp[34]|wav|mov|webm|log';
const STUCK_NAMES = new RegExp(`^(.+?\\.(?:${STUCK_EXTS}))([A-Za-z][\\w .+-]*\\.[A-Za-z0-9]{1,8})$`, 'i');

/**
 * One display/storage name for a user file. Strips path segments and control
 * characters. Never joins multiple File names.
 */
export function canonicalFileName(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  const base = trimmed.split(/[/\\]/).pop() || trimmed;
  return base.slice(0, MAX_NAME) || '';
}

/**
 * Detects names that look like two filenames stuck together without a separator
 * (e.g. Untitled 3.txtmaelstrom-qa-fixture.txt). Returns the parts or null.
 */
export function stuckFileNameParts(value) {
  const name = canonicalFileName(value);
  if (!name) return null;
  const match = name.match(STUCK_NAMES);
  if (!match) return null;
  const left = match[1].trim();
  const right = match[2].trim();
  if (!left || !right || left === right) return null;
  return [left.slice(0, MAX_NAME), right.slice(0, MAX_NAME)];
}

/**
 * Prefer a readable label when a single name appears to be two stuck filenames.
 */
export function displayFileName(value) {
  const parts = stuckFileNameParts(value);
  if (parts) return parts.join(' · ').slice(0, MAX_NAME);
  return canonicalFileName(value);
}
