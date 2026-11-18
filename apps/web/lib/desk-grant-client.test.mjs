/**
 * Unit tests for browser desk lock / grant client helpers.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  openDeskGrant,
  readDeskLockState,
  registerDeskVerifier,
} from './desk-grant-client.mjs';

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

  let replaced;
  const again = await registerDeskVerifier(async (_url, init) => {
    replaced = JSON.parse(init.body);
    return new Response('', { status: 200 });
  }, {
    ownerId: 'did:privy:u1',
    verifier: { salt: 's', hash: 'h', iterations: 1 },
    replace: true,
  });
  assert.deepEqual(again, { ok: true });
  assert.equal(replaced.replace, true);
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
