/**
 * Desk state that follows the account, not the browser.
 *
 * Existing helpers keep reading and writing local storage. This module mirrors
 * a fixed list of keys to the account: hydrate pulls them on sign-in, and every
 * write is pushed after a short delay. The account copy wins on sign-in. A
 * browser that has data the account lacks pushes it up once.
 *
 * Not mirrored on purpose: the file catalog (it holds each file's secret id,
 * which the server never keeps), provider keys, the desk password, the seed
 * phrase, session tokens, and per-device layout.
 */
import { ownerAuthHeaders } from './owner-auth-headers.mjs';
import { shellRuntimeUrl } from './runtime-data.mjs';
import { accountStorageKey } from './account-code.mjs';
import { LEGACY_LOOKS_KEY, LEGACY_ROSTER_KEY, looksStorageKey, rosterStorageKey } from './roster.mjs';
import { talkStorageKey } from './talk-store.mjs';
import { tokenStorageKey } from './wallet-desk.mjs';
import { voiceTimeKey } from './voice-time.mjs';
import { VOICE_STORAGE_KEY } from './voice-settings.mjs';
import {
  REVIEW_THRESHOLD_KEY,
  SPEND_PERMISSION_KEY,
  acceptanceStorageKey,
} from './spend-permission.mjs';

// Matches the Worker limit. The same-origin proxy refuses bodies over 1,000,000 bytes.
export const STATE_VALUE_MAX = 900_000;
const PUSH_DELAY_MS = 1200;
const RETRY_MS = 8000;
const RETRY_MAX = 5;
const KEEPALIVE_MAX = 60_000;
const HYDRATE_MS = 8000;
const DESK_DEFAULTS = new Map([
  ['roster', '{"order":[],"extra":[]}'],
  ['looks', '{}'],
  ['talks', '{}'],
]);
const LEGACY_DESK_NAMES = new Map([[LEGACY_ROSTER_KEY, 'roster'], [LEGACY_LOOKS_KEY, 'looks']]);

/** Every mirrored entry for one owner: account name, local key, and whether the key is shared by the browser. */
export function mirrorEntries(ownerId) {
  if (typeof ownerId !== 'string' || !ownerId.trim()) return [];
  const id = ownerId.trim();
  const rows = [
    { name: 'roster', key: rosterStorageKey(id) },
    { name: 'looks', key: looksStorageKey(id) },
    { name: 'talks', key: talkStorageKey(id) },
    { name: 'tokens', key: tokenStorageKey(id) },
    { name: 'acceptance', key: acceptanceStorageKey(id) },
    { name: 'voiceTime', key: voiceTimeKey(id) },
    { name: 'accountCode', key: accountStorageKey(id) },
    { name: 'permission', key: SPEND_PERMISSION_KEY, shared: true },
    { name: 'reviewCap', key: REVIEW_THRESHOLD_KEY, shared: true },
    { name: 'voiceSettings', key: VOICE_STORAGE_KEY, shared: true },
  ];
  return rows.filter(row => row.key);
}

function pushable(value) {
  return value === null || (typeof value === 'string' && value.length <= STATE_VALUE_MAX);
}

function safeGet(storage, key) {
  try { return storage.getItem(key); } catch { return null; }
}

function safeSet(storage, key, value) {
  try { storage.setItem(key, value); } catch { /* the account copy still holds it */ }
}

function safeRemove(storage, key) {
  try { storage.removeItem(key); } catch { /* ignore */ }
}

function withoutDeletedAgents(name, value, deleted) {
  if (!deleted.size || !DESK_DEFAULTS.has(name) || typeof value !== 'string') return value;
  let parsed;
  try { parsed = JSON.parse(value); } catch { return value; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return value;
  if (name === 'roster') {
    const order = Array.isArray(parsed.order) ? parsed.order.filter(id => !deleted.has(id)) : null;
    const extra = Array.isArray(parsed.extra) ? parsed.extra.filter(bot => !deleted.has(bot?.id)) : null;
    if (!(order && order.length !== parsed.order.length) && !(extra && extra.length !== parsed.extra.length)) return value;
    if (order) parsed.order = order;
    if (extra) parsed.extra = extra;
  } else {
    const removed = Object.keys(parsed).filter(id => deleted.has(id));
    if (!removed.length) return value;
    for (const id of removed) delete parsed[id];
  }
  return JSON.stringify(parsed);
}

/**
 * Builds one mirror for one signed-in owner.
 * `storage` is the browser store. `storage` in the result is a drop-in that
 * pushes mirrored writes to the account.
 */
export function createAccountMirror({
  storage,
  ownerId,
  getAccessToken = null,
  fetchImpl = (...args) => fetch(...args),
  delayMs = PUSH_DELAY_MS,
  retryMs = RETRY_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = id => clearTimeout(id),
} = {}) {
  const entries = mirrorEntries(ownerId);
  const byKey = new Map(entries.map(entry => [entry.key, entry]));
  const pending = new Map();
  // The desk saves snapshots on mount. Its unchanged startup state is not an account edit.
  const lastDeskValue = new Map(DESK_DEFAULTS);
  let deletedAgents = new Set();
  let timer = null;
  let retries = 0;
  let lastWrite = null;
  let live = Boolean(storage) && entries.length > 0;
  // Nothing is pushed until the account copy was read. A browser that could not
  // read it must not overwrite what the account already holds.
  let open = false;

  function send(items, { keepalive = false } = {}) {
    async function post() {
      const url = shellRuntimeUrl('/api/state');
      if (!live || !url) return false;
      const headers = await ownerAuthHeaders(ownerId, getAccessToken, { 'content-type': 'application/json' });
      const body = JSON.stringify({ items });
      const response = await fetchImpl(url, {
        method: 'POST',
        headers,
        body,
        cache: 'no-store',
        ...(keepalive && body.length < KEEPALIVE_MAX ? { keepalive: true } : {}),
      });
      return response.ok;
    }
    const write = (lastWrite ? lastWrite.then(post) : post()).catch(() => false);
    lastWrite = write;
    void write.then(() => { if (lastWrite === write) lastWrite = null; });
    return write;
  }

  async function flush({ keepalive = false } = {}) {
    if (timer != null) {
      clearTimer(timer);
      timer = null;
    }
    if (!live || pending.size === 0) return true;
    const batch = [...pending.entries()].slice(0, 12);
    for (const [name] of batch) pending.delete(name);
    const items = batch.map(([name, value]) => ({ name, value }));
    const ok = await send(items, { keepalive });
    if (ok) {
      retries = 0;
    } else {
      // A newer write for the same name wins. Otherwise put it back.
      for (const { name, value } of items) if (!pending.has(name)) pending.set(name, value);
      if (retries < RETRY_MAX) {
        retries += 1;
        schedule(retryMs * retries);
      }
    }
    if (ok && pending.size > 0) return flush({ keepalive });
    return ok;
  }

  function schedule(ms = delayMs) {
    if (!live || timer != null) return;
    timer = setTimer(() => {
      timer = null;
      flush();
    }, ms);
  }

  function queue(name, value) {
    if (!live || !open || !pushable(value)) return;
    if (lastDeskValue.has(name)) {
      if (lastDeskValue.get(name) === value) return;
      lastDeskValue.set(name, value);
    }
    pending.set(name, value);
    schedule();
  }

  const mirrored = {
    getItem(key) {
      return withoutDeletedAgents(byKey.get(key)?.name ?? LEGACY_DESK_NAMES.get(key), storage.getItem(key), deletedAgents);
    },
    setItem(key, value) {
      const entry = byKey.get(key);
      const next = withoutDeletedAgents(entry?.name, String(value), deletedAgents);
      storage.setItem(key, next);
      if (entry) queue(entry.name, next);
    },
    removeItem(key) {
      storage.removeItem(key);
      const entry = byKey.get(key);
      if (entry) queue(entry.name, null);
    },
  };

  /**
   * Pulls the account copy into local storage. The account wins. A local value
   * the account lacks is pushed once. Returns { ok:false } when the account
   * store cannot be read, and the desk then runs on this browser's copy.
   */
  async function hydrate() {
    if (!live) return { ok: false, error: 'not_ready' };
    const url = shellRuntimeUrl('/api/state');
    if (!url) return { ok: false, error: 'runtime' };
    let body = null;
    try {
      const headers = await ownerAuthHeaders(ownerId, getAccessToken);
      const response = await fetchImpl(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(HYDRATE_MS) });
      if (!response.ok) return { ok: false, error: 'state_unavailable' };
      body = await response.json();
    } catch {
      return { ok: false, error: 'state_unavailable' };
    }
    if (!body || body.source === 'unconfigured' || !Array.isArray(body.items)) {
      return { ok: false, error: 'unconfigured' };
    }
    deletedAgents = new Set(Array.isArray(body.deletedAgentIds) ? body.deletedAgentIds.filter(id => typeof id === 'string') : []);
    const server = new Map();
    for (const item of body.items) {
      if (item && typeof item.name === 'string' && typeof item.value === 'string') server.set(item.name, item.value);
    }
    const acceptanceKey = entries.find(entry => entry.name === 'acceptance')?.key ?? '';
    const accepted = server.get('acceptance') === '1' || (acceptanceKey !== '' && safeGet(storage, acceptanceKey) === '1');
    const upload = [];
    for (const entry of entries) {
      const remote = withoutDeletedAgents(entry.name, server.get(entry.name), deletedAgents);
      if (typeof remote === 'string') {
        if (DESK_DEFAULTS.has(entry.name)) lastDeskValue.set(entry.name, remote);
        safeSet(storage, entry.key, remote);
        continue;
      }
      // Spend mode and the Review cap are shared keys. Another account's values must not carry over.
      if ((entry.name === 'permission' || entry.name === 'reviewCap') && !accepted) {
        safeRemove(storage, entry.key);
        continue;
      }
      const cached = safeGet(storage, entry.key);
      const local = withoutDeletedAgents(entry.name, cached, deletedAgents);
      if (local !== cached) safeSet(storage, entry.key, local);
      if (typeof local === 'string' && pushable(local) && local !== DESK_DEFAULTS.get(entry.name)) {
        upload.push({ name: entry.name, value: local });
      }
    }
    if (upload.length > 0) {
      for (let index = 0; index < upload.length; index += 12) {
        const batch = upload.slice(index, index + 12);
        if (await send(batch)) {
          for (const { name, value } of batch) {
            if (DESK_DEFAULTS.has(name)) lastDeskValue.set(name, value);
          }
        }
      }
    }
    open = true;
    return { ok: true, pulled: server.size, pushed: upload.length };
  }

  function stop() {
    live = false;
    if (timer != null) clearTimer(timer);
    timer = null;
    pending.clear();
  }

  return { ownerId, storage: mirrored, hydrate, flush, stop, entries };
}

/* Singleton used by the desk. Components import `accountStorage` for mirrored writes. */

let current = null;
let listening = false;

function browserStorage() {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

export const accountStorage = {
  getItem(key) {
    const store = current?.storage ?? browserStorage();
    return store ? store.getItem(key) : null;
  },
  setItem(key, value) {
    const store = current?.storage ?? browserStorage();
    if (store) store.setItem(key, value);
  },
  removeItem(key) {
    const store = current?.storage ?? browserStorage();
    if (store) store.removeItem(key);
  },
};

function listenForExit() {
  if (listening || typeof window === 'undefined' || typeof document === 'undefined') return;
  listening = true;
  window.addEventListener('pagehide', () => { current?.flush({ keepalive: true }); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') current?.flush({ keepalive: true });
  });
}

/** Call with the signed-in owner. Call with no owner on sign-out. */
export function bindAccountState({ ownerId = '', getAccessToken = null, fetchImpl } = {}) {
  current?.stop();
  current = null;
  const store = browserStorage();
  if (!ownerId || !store) return null;
  current = createAccountMirror({ storage: store, ownerId, getAccessToken, ...(fetchImpl ? { fetchImpl } : {}) });
  listenForExit();
  return current;
}

export function hydrateAccountState() {
  return current ? current.hydrate() : Promise.resolve({ ok: false, error: 'not_ready' });
}

/** Push queued desk state now. A missing mirror is a no-op. */
export function flushAccountState() {
  return current ? current.flush() : Promise.resolve(false);
}
