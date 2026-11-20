/**
 * Rigor audit — Durable Object position-check / status authorization
 * Achieves: unauthenticated status hides positionCheck; mismatched owner gets 403;
 *   public position-check requires owner; body.ownerId forge is rejected; internal
 *   cron header can write checks.
 * Fails when: position books leak on bare GET /status, or Alice can read Bob's check.
 * Oracle: meta.ownerId + x-owner-id; INTERNAL_POSITION_HEADER only for stub cron.
 * Side effects: in-memory BotStateMachine Map only.
 * Gaps: does not exercise Cloudflare DO network isolation or Worker assertBotOwner
 *   (covered in position-auth.routes.test.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BotStateMachine, INTERNAL_POSITION_HEADER, INTERNAL_POSITION_VALUE } from './bot-do.mjs';

const MINT = 'So11111111111111111111111111111111111111112';

function positionBody(ownerId = 'alice') {
  return {
    botId: 'bot_1',
    ownerId,
    maxLoss: '1000000',
    positions: [{ mint: MINT, amount: '1000000000', decimals: 9, entryPriceUsd: '150.00' }],
    quotes: {
      [MINT]: { priceUsd: '140.00', quoteSource: 'dexscreener' },
    },
    now: 1_700_000_000_000,
    reason: 'cron-hourly',
    available: true,
  };
}

test('unauthenticated status never returns positionCheck or run', async () => {
  const machine = new BotStateMachine();
  await machine.put('meta', { botId: 'bot_1', ownerId: 'alice', cluster: 'mainnet-beta', updatedAt: 1 });
  await machine.put('lastPositionCheck', { botId: 'bot_1', positions: [{ mint: MINT, amount: '1' }], flag: 'within-cap' });
  await machine.put('run', { runId: 'secret-run', goal: 'do not leak' });

  const res = await machine.handle(new Request('https://bot/status'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.positionCheck, null);
  assert.equal(body.run, null);
  assert.equal(body.meta?.ownerId, undefined);
  assert.equal(body.auth, 'required');
});

test('owner mismatch on status is forbidden and returns no check payload', async () => {
  const machine = new BotStateMachine();
  await machine.put('meta', { botId: 'bot_1', ownerId: 'alice', cluster: 'mainnet-beta', updatedAt: 1 });
  await machine.put('lastPositionCheck', { botId: 'bot_1', flag: 'max-loss', positions: [{ amount: '9' }] });

  const res = await machine.handle(new Request('https://bot/status', {
    headers: { 'x-owner-id': 'bob' },
  }));
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, 'owner_forbidden');
  assert.equal(body.positionCheck, undefined);
});

test('matching owner receives positionCheck', async () => {
  const machine = new BotStateMachine();
  await machine.put('meta', { botId: 'bot_1', ownerId: 'alice', cluster: 'mainnet-beta', updatedAt: 1 });
  await machine.put('lastPositionCheck', { botId: 'bot_1', paper: false, flag: 'within-cap', positions: [] });

  const res = await machine.handle(new Request('https://bot/status', {
    headers: { 'x-owner-id': 'alice' },
  }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.positionCheck.flag, 'within-cap');
});

test('public position-check without owner is 401; forged body ownerId is 403', async () => {
  const machine = new BotStateMachine();
  await machine.put('meta', { botId: 'bot_1', ownerId: 'alice', cluster: 'mainnet-beta', updatedAt: 1 });

  const denied = await machine.handle(new Request('https://bot/position-check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(positionBody('alice')),
  }));
  assert.equal(denied.status, 401);

  const forged = await machine.handle(new Request('https://bot/position-check', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'bob' },
    body: JSON.stringify(positionBody('alice')),
  }));
  assert.equal(forged.status, 403);
  // meta.ownerId is alice — mismatched header is forbidden before body is trusted.
  assert.equal((await forged.json()).error, 'owner_forbidden');

  const blank = new BotStateMachine();
  const bodyForge = await blank.handle(new Request('https://bot/position-check', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'bob' },
    body: JSON.stringify(positionBody('alice')),
  }));
  assert.equal(bodyForge.status, 403);
  assert.equal((await bodyForge.json()).error, 'owner_mismatch');
});

test('only the internal cron can record holdings and owners can read the check', async () => {
  const machine = new BotStateMachine();
  const internal = await machine.handle(new Request('https://bot/position-check', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [INTERNAL_POSITION_HEADER]: INTERNAL_POSITION_VALUE,
      'x-owner-id': 'alice',
    },
    body: JSON.stringify(positionBody('alice')),
  }));
  assert.equal(internal.status, 200);
  const saved = await machine.get('lastPositionCheck');
  assert.equal(saved.botId, 'bot_1');
  assert.equal(saved.paper, false);
  assert.ok(Array.isArray(saved.positions));

  const asOwner = await machine.handle(new Request('https://bot/position-check', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-owner-id': 'alice',
    },
    body: JSON.stringify({ ...positionBody('alice'), positions: [{ mint: MINT, amount: '9999999' }] }),
  }));
  assert.equal(asOwner.status, 200);
  assert.equal((await asOwner.json()).check.positions[0].amount, '1000000000');
  assert.deepEqual(await machine.get('lastPositionCheck'), saved);
});
