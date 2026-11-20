/**
 * Unit tests for browser desk lock / grant client helpers.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDeskLock, readDeskGrant, readDeskLock, unlockDesk } from './desk-lock.mjs';
import {
  acceptEnteredPassword,
  openDeskGrant,
  readDeskLockState,
  registerDeskVerifier,
  submitChatSpend,
} from './desk-grant-client.mjs';

test('a confirmed spend reuses the same send once after a successful unlock', async () => {
  let attempts = 0;
  let prompts = 0;
  const signal = new AbortController().signal;
  const rejected = { ok: false, error: 'desk_locked' };
  const result = await submitChatSpend({
    signal,
    send: async () => { attempts++; return rejected; },
    unlock: async () => { prompts++; return true; },
  });
  assert.equal(result, rejected);
  assert.equal(attempts, 2);
  assert.equal(prompts, 1);
});

test('a dismissed or stopped unlock and other spend failures never retry', async () => {
  for (const scenario of ['dismiss', 'stop', 'sign-rejected']) {
    let attempts = 0;
    let prompts = 0;
    const controller = new AbortController();
    const rejected = { ok: false, error: scenario === 'sign-rejected' ? scenario : 'desk_locked' };
    const result = await submitChatSpend({
      signal: controller.signal,
      send: async () => { attempts++; return rejected; },
      unlock: async () => {
        prompts++;
        if (scenario === 'stop') { controller.abort(); return true; }
        return false;
      },
    });
    assert.equal(result.error, { dismiss: 'unlock_cancelled', stop: 'aborted', 'sign-rejected': 'sign-rejected' }[scenario]);
    assert.equal(attempts, 1);
    assert.equal(prompts, scenario === 'sign-rejected' ? 0 : 1);
  }
});

/**
 * Rigor audit — desk client missing runtime / owner
 * Achieves: no owner (or missing password/verifier) returns ok:false without fetch.
 * Fails when: fetch is called with empty owner or password omitted on unlock.
 * Oracle: shellRuntimeUrl requires owner; unlock requires password string.
 * Side effects: none (fetch never called).
 * Gaps: none for local guards.
 */
test('desk grant client returns runtime errors without calling fetch when inputs missing', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response('{}');
  };
  assert.deepEqual(await readDeskLockState(fetchImpl, {}), { ok: false, locked: false });
  assert.deepEqual(await registerDeskVerifier(fetchImpl, { ownerId: 'did:privy:u1' }), {
    ok: false,
    error: 'runtime',
  });
  assert.deepEqual(await openDeskGrant(fetchImpl, { ownerId: 'did:privy:u1' }), {
    ok: false,
    error: 'runtime',
  });
  assert.equal(calls, 0);
});

/**
 * Rigor audit — readDeskLockState
 * Achieves: maps ok+locked from runtime JSON; non-ok → ok:false with error code.
 * Fails when: locked true on error responses or password is stored in the request.
 * Oracle: GET /api/runtime/api/desk with x-owner-id (+ optional bearer).
 * Side effects: stub fetch records headers; password never sent on read.
 * Gaps: does not hit a live Worker.
 */
test('readDeskLockState maps locked flag and failure codes', async () => {
  let seen;
  const locked = await readDeskLockState(async (url, init) => {
    seen = { url, headers: init.headers };
    return new Response(JSON.stringify({ locked: true }), { status: 200 });
  }, { ownerId: 'did:privy:u1', token: 'tok' });
  assert.deepEqual(locked, { ok: true, locked: true });
  assert.equal(seen.url, '/api/runtime/api/desk');
  assert.equal(seen.headers['x-owner-id'], 'did:privy:u1');
  assert.equal(seen.headers.authorization, 'Bearer tok');
  assert.equal(Object.prototype.hasOwnProperty.call(seen.headers, 'password'), false);

  const failed = await readDeskLockState(async () => (
    new Response(JSON.stringify({ error: 'desk_boom' }), { status: 502 })
  ), { ownerId: 'did:privy:u1' });
  assert.deepEqual(failed, { ok: false, locked: false, error: 'desk_boom' });
});

/**
 * Rigor audit — registerDeskVerifier
 * Achieves: 409 → ok+exists; other errors → desk_lock_failed; posts salt/hash/iterations only.
 * Fails when: password field is sent or 409 treated as failure.
 * Oracle: POST /api/runtime/api/desk/lock verifier payload.
 * Side effects: stub fetch.
 * Gaps: none for client mapping.
 */
test('registerDeskVerifier treats 409 as exists and never sends the password', async () => {
  let body;
  const exists = await registerDeskVerifier(async (url, init) => {
    body = JSON.parse(init.body);
    assert.equal(url, '/api/runtime/api/desk/lock');
    assert.equal(init.method, 'POST');
    return new Response('', { status: 409 });
  }, {
    ownerId: 'did:privy:u1',
    token: 'tok',
    verifier: { salt: 's', hash: 'h', iterations: 100000 },
  });
  assert.deepEqual(exists, { ok: true, exists: true });
  assert.deepEqual(body, { salt: 's', hash: 'h', iterations: 100000 });
  assert.equal(Object.prototype.hasOwnProperty.call(body, 'password'), false);

  const failed = await registerDeskVerifier(async () => new Response('', { status: 500 }), {
    ownerId: 'did:privy:u1',
    verifier: { salt: 's', hash: 'h', iterations: 1 },
  });
  assert.deepEqual(failed, { ok: false, error: 'desk_lock_failed' });

  const ok = await registerDeskVerifier(async () => new Response('', { status: 200 }), {
    ownerId: 'did:privy:u1',
    verifier: { salt: 's', hash: 'h', iterations: 1 },
  });
  assert.deepEqual(ok, { ok: true });

  const proof = 'ab'.repeat(32);
  const missingProof = await registerDeskVerifier(async () => new Response('', { status: 200 }), {
    ownerId: 'did:privy:u1',
    verifier: { salt: 's', hash: 'h', iterations: 1 },
    replace: true,
  });
  assert.deepEqual(missingProof, { ok: false, error: 'recovery_required' });

  let replaced;
  const again = await registerDeskVerifier(async (_url, init) => {
    replaced = JSON.parse(init.body);
    return new Response('', { status: 200 });
  }, {
    ownerId: 'did:privy:u1',
    verifier: { salt: 's', hash: 'h', iterations: 1 },
    replace: true,
    proof,
  });
  assert.deepEqual(again, { ok: true });
  assert.equal(replaced.replace, true);
  assert.equal(replaced.proof, proof);
  assert.equal(Object.prototype.hasOwnProperty.call(replaced, 'password'), false);
});

/**
 * Rigor audit — openDeskGrant
 * Achieves: password sent once in JSON body (not headers); grant+until returned;
 *   non-ok / missing grant → desk_locked (or upstream error).
 * Fails when: password is written to headers/storage fields or grant omitted on 200.
 * Oracle: POST /api/runtime/api/desk/unlock { password }.
 * Side effects: stub fetch; password only in request body string.
 * Gaps: does not prove Worker verifier crypto.
 */
test('openDeskGrant posts password once and returns grant without echoing it', async () => {
  let seen;
  const ok = await openDeskGrant(async (url, init) => {
    seen = { url, headers: init.headers, body: init.body };
    return new Response(JSON.stringify({ grant: 'grant_abc', until: 123 }), { status: 200 });
  }, { ownerId: 'did:privy:u1', token: 'tok', password: 'secret-pass' });
  assert.deepEqual(ok, { ok: true, grant: 'grant_abc', until: 123 });
  assert.equal(seen.url, '/api/runtime/api/desk/unlock');
  assert.equal(seen.headers.authorization, 'Bearer tok');
  assert.equal(Object.prototype.hasOwnProperty.call(seen.headers, 'password'), false);
  assert.equal(JSON.parse(seen.body).password, 'secret-pass');

  const denied = await openDeskGrant(async () => (
    new Response(JSON.stringify({ error: 'bad_password' }), { status: 403 })
  ), { ownerId: 'did:privy:u1', password: 'nope' });
  assert.deepEqual(denied, { ok: false, error: 'bad_password' });

  const missingGrant = await openDeskGrant(async () => (
    new Response(JSON.stringify({ until: 1 }), { status: 200 })
  ), { ownerId: 'did:privy:u1', password: 'x' });
  assert.deepEqual(missingGrant, { ok: false, error: 'desk_locked' });
});

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

/**
 * Achieves: Enter Password does not replace a different account verifier.
 * Fails when: a wrong password is accepted, or a local match overwrites the account verifier.
 * Oracle: wrong password makes no request; a local match that the account rejects does not call lock.
 * Side effects: in-memory storage and stub fetch. PBKDF2 only.
 * Gaps: the React dialog is not mounted. Seed reset is the lock route with a proof.
 */
test('Enter Password does not replace the account verifier without the seed', async () => {
  const ownerId = 'did:privy:u1';
  const local = memoryStorage();
  const session = memoryStorage();
  const browserCopy = await createDeskLock('fresh horse');
  let account = await createDeskLock('older horse');
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    if (String(url).includes('/desk/unlock')) {
      const matches = await unlockDesk(body.password, account);
      if (!matches) return new Response(JSON.stringify({ error: 'desk_locked' }), { status: 401 });
      return new Response(JSON.stringify({ grant: 'cd'.repeat(32), until: Date.now() + 60_000 }), { status: 200 });
    }
    if (String(url).includes('/desk/lock')) {
      account = { v: 1, salt: body.salt, hash: body.hash, iterations: body.iterations };
      return new Response(JSON.stringify({ ok: true, replaced: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
  };

  const refused = await acceptEnteredPassword({
    fetchImpl,
    ownerId,
    token: 'tok',
    password: 'not the copy',
    record: browserCopy,
    localStorage: local,
    sessionStorage: session,
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'wrong_password');
  assert.equal(calls.length, 0);

  const accepted = await acceptEnteredPassword({
    fetchImpl,
    ownerId,
    token: 'tok',
    password: 'fresh horse',
    record: browserCopy,
    localStorage: local,
    sessionStorage: session,
  });
  assert.equal(accepted.ok, false);
  assert.equal(calls.some(call => String(call.url).includes('/desk/lock')), false);
  assert.equal(await unlockDesk('older horse', account), true);
  assert.equal(await unlockDesk('fresh horse', account), false);
  assert.equal(readDeskGrant(session, ownerId, Date.now()), null);
});
