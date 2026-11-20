import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withPrivyLogout, MAELSTROM_TOKEN_KEY, MAELSTROM_CUSTOMER_KEY, MAELSTROM_REFRESH_KEY } from './accept-terms-auth.mjs';
import { logoutAfterFlush } from './profile-logout.mjs';

function storage() {
  const values = new Map([MAELSTROM_TOKEN_KEY, MAELSTROM_CUSTOMER_KEY, MAELSTROM_REFRESH_KEY].map(key => [key, 'cached']));
  return { getItem: key => values.get(key) ?? null, removeItem: key => values.delete(key) };
}

test('profile menu and profile sheet share logout with desk locking and Privy cleanup', () => {
  const menu = readFileSync(new URL('../components/AccountMenu.js', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../app/page.js', import.meta.url), 'utf8');
  assert.match(menu, /id: 'logout', label: 'Log out', icon: LogOut/);
  assert.match(menu, /setOpen\(false\);\s+onPick\(item.id\)/);
  assert.match(page, /if \(id === 'logout'\) \{\s+void logOut\(\)/);
  assert.match(page, /const logOut = useCallback\(async \(\) => \{\s+lockWallet\(\);\s+setProfileOpen\(false\);\s+try \{\s+await logoutAfterFlush\(flushAccountState, onLogout\)/);
  assert.match(page, /onLogout=\{logOut\}/);
  assert.match(page, /withPrivyLogout\(window, \(\) => logout\(\)\)/);
  assert.match(page, /clearDeskSession\(localStorage, ownerId\)/);
  assert.match(page, /Could not log out\. Please try again\./);
});

for (const fails of [false, true]) {
  test(`logout clears app backups and cache when Privy ${fails ? 'rejects' : 'succeeds'}`, async () => {
    let cleared = false;
    let called = false;
    const target = {
      localStorage: storage(), sessionStorage: storage(),
      __maelstromAcceptTermsAuth: { clear: () => { cleared = true; } },
    };
    const pending = withPrivyLogout(target, async () => {
      called = true;
      if (fails) throw new Error('logout failed');
    });
    if (fails) await assert.rejects(pending, /logout failed/);
    else await pending;
    assert.equal(called, true);
    assert.equal(cleared, true);
    for (const store of [target.localStorage, target.sessionStorage]) {
      for (const key of [MAELSTROM_TOKEN_KEY, MAELSTROM_CUSTOMER_KEY, MAELSTROM_REFRESH_KEY]) {
        assert.equal(store.getItem(key), null);
      }
    }
  });
}

test('logout works without stored app session state', async () => {
  let called = false;
  await withPrivyLogout({}, async () => { called = true; });
  assert.equal(called, true);
});

test('logout waits for a queued desk save before ending the session', async () => {
  const calls = [];
  await logoutAfterFlush(async () => { calls.push('save'); }, async () => { calls.push('logout'); });
  assert.deepEqual(calls, ['save', 'logout']);
});

test('a stalled desk save cannot prevent logout', async () => {
  let called = false;
  await logoutAfterFlush(() => new Promise(() => {}), async () => { called = true; }, 10);
  assert.equal(called, true);
});

test('logout continues after a failed desk save and propagates logout errors', async () => {
  await assert.rejects(logoutAfterFlush(
    async () => { throw new Error('save failed'); },
    async () => { throw new Error('logout failed'); },
  ), /logout failed/);
});
