/**
 * One 16-digit account id per owner. Files store it. A read has to present the same id.
 * The id stays out of chat and out of the model prompt.
 */
const CODE = /^[0-9]{16}$/;

export function isAccountCode(value) {
  return typeof value === 'string' && CODE.test(value);
}

export function accountCodeFromBytes(bytes) {
  let out = '';
  for (const value of bytes) {
    if (value >= 250) continue;
    out += String(value % 10);
    if (out.length === 16) return out;
  }
  return out;
}

export function createAccountCode(read = randomCodeBytes) {
  let code = '';
  while (code.length < 16) code += accountCodeFromBytes(read());
  return code.slice(0, 16);
}

export function accountStorageKey(ownerId) {
  return typeof ownerId === 'string' && ownerId.trim() ? `maelstrom.accountCode.${ownerId.trim()}` : '';
}

export function readAccountCode(storage, ownerId) {
  const key = accountStorageKey(ownerId);
  if (!storage || !key) return '';
  try {
    const value = storage.getItem(key);
    return isAccountCode(value) ? value : '';
  } catch {
    return '';
  }
}

export function ensureAccountCode(storage, ownerId, create = createAccountCode) {
  const existing = readAccountCode(storage, ownerId);
  if (existing) return existing;
  const key = accountStorageKey(ownerId);
  if (!storage || !key) return '';
  const code = create();
  if (!isAccountCode(code)) return '';
  try {
    storage.setItem(key, code);
  } catch {
    return '';
  }
  return code;
}

function randomCodeBytes() {
  const bytes = new Uint8Array(64);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}
