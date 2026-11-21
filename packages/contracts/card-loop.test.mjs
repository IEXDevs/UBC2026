import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_LOOP_COOLDOWN_MINUTES,
  cardLoopDue,
  cardLoopReport,
  createCardLoop,
  formatCooldown,
  ownerAskedToBreakLoop,
  ownerBreakAuthorized,
  parseCooldownMinutes,
  publicCardLoop,
  setCardLoopCooldown,
  CardLoopError,
} from './card-loop.mjs';

const NOW = 1_700_000_000_000;

/**
 * Achieves: a loop stores its purpose and a cooldown of at least 15 minutes.
 * Fails when: 14 minutes is stored, the purpose is dropped, or the next wake is early.
 * Oracle: createCardLoop result fields and thrown CardLoopError codes.
 * Side effects: none.
 * Gaps: Durable Object persistence is covered in the agent-runtime tests.
 */
test('create_loop stores the purpose and rejects a cooldown under 15 minutes', () => {
  assert.equal(MIN_LOOP_COOLDOWN_MINUTES, 15);
  const loop = createCardLoop({
    botId: 'bot_1',
    purpose: '  Check positions  ',
    cooldownMinutes: '15',
    now: NOW,
  });
  assert.equal(loop.purpose, 'Check positions');
  assert.equal(loop.cooldownMinutes, 15);
  assert.equal(loop.active, true);
  assert.equal(loop.nextWakeAt, NOW + 15 * 60_000);
  assert.equal(publicCardLoop(loop).cooldownLabel, '15m');
  assert.equal(cardLoopReport(loop), null);
  assert.equal(formatCooldown(60), '1h');
  assert.equal(formatCooldown(1440), '1d');
  assert.equal(cardLoopDue(loop, NOW + 15 * 60_000 - 1), false);
  assert.equal(cardLoopDue(loop, NOW + 15 * 60_000), true);

  assert.throws(() => parseCooldownMinutes('14'), (error) => error instanceof CardLoopError && error.code === 'cooldown_too_short');
  assert.throws(() => parseCooldownMinutes(10), (error) => error.code === 'cooldown_too_short');
  assert.throws(() => parseCooldownMinutes('0'), (error) => error.code === 'cooldown_invalid');
  assert.throws(() => createCardLoop({ botId: 'bot_1', purpose: 'Check positions', cooldownMinutes: '14', now: NOW }), (error) => error.code === 'cooldown_too_short');
  assert.throws(() => createCardLoop({ botId: 'bot_1', purpose: '   ', cooldownMinutes: '15', now: NOW }), (error) => error.code === 'purpose_required');
});

test('loop status carries the latest run and hides unknown provider errors', () => {
  const loop = createCardLoop({ botId: 'bot_1', purpose: 'Check positions', cooldownMinutes: 60, now: NOW });
  const checked = publicCardLoop({ ...loop, lastWakeAt: NOW + 3600000, lastGate: 'no-trade-found' });
  assert.deepEqual(cardLoopReport(checked), {
    at: NOW + 3600000, gate: 'no-trade-found', summary: 'Scheduled check completed. No trade found.',
  });
  const failed = publicCardLoop({ ...loop, lastWakeAt: NOW, lastGate: 'provider failure https://rpc.example/secret' });
  assert.equal(failed.lastGate, 'loop_failed');
  assert.doesNotMatch(JSON.stringify(failed), /https:|secret/);
});

/**
 * Achieves: cooldown changes stay on the same loop and still reject under 15 minutes.
 * Fails when: a short cooldown replaces a valid one, or a missing loop is updated.
 * Oracle: setCardLoopCooldown return value and error codes.
 * Side effects: none.
 * Gaps: none.
 */
test('set_loop_cooldown updates the stored cooldown and rejects a shorter one', () => {
  const loop = createCardLoop({ botId: 'bot_1', purpose: 'Check positions', cooldownMinutes: 30, now: NOW });
  const next = setCardLoopCooldown(loop, '60', NOW + 1000);
  assert.equal(next.purpose, 'Check positions');
  assert.equal(next.cooldownMinutes, 60);
  assert.equal(next.nextWakeAt, NOW + 1000 + 60 * 60_000);
  assert.equal(publicCardLoop(next).cooldownLabel, '1h');
  assert.throws(() => setCardLoopCooldown(null, '30', NOW), (error) => error.code === 'no_loop');
  assert.throws(() => setCardLoopCooldown(loop, 14, NOW), (error) => error.code === 'cooldown_too_short');
});

/**
 * Achieves: only the owner's words authorize a break. A model-supplied flag does not.
 * Fails when: "check positions" counts as a break, or a header other than owner-asked does.
 * Oracle: ownerAskedToBreakLoop and ownerBreakAuthorized.
 * Side effects: none.
 * Gaps: HTTP header wiring is covered in the runtime and chat tool tests.
 */
test('break_loop is authorized only when the owner asks', () => {
  assert.equal(ownerAskedToBreakLoop('Please break the loop'), true);
  assert.equal(ownerAskedToBreakLoop('stop that loop'), true);
  assert.equal(ownerAskedToBreakLoop('cancel the loop now'), true);
  assert.equal(ownerAskedToBreakLoop('quit looping'), true);
  assert.equal(ownerAskedToBreakLoop('no more loops'), true);
  assert.equal(ownerAskedToBreakLoop('Check positions every 15 minutes'), false);
  assert.equal(ownerAskedToBreakLoop('ownerAsked true'), false);
  assert.equal(ownerAskedToBreakLoop(''), false);
  assert.equal(ownerBreakAuthorized('owner-asked'), true);
  assert.equal(ownerBreakAuthorized('true'), false);
  assert.equal(ownerBreakAuthorized(undefined), false);
});
