import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyRun, advanceRun, pauseRun, resumeRun } from './checkpoint.mjs';
import { BotStateMachine } from './bot-do.mjs';

test('run checkpoints advance and pause without losing history', () => {
  let run = createEmptyRun({ runId: 'run_1', botId: 'bot_1', goal: 'yield', now: 1 });
  run = advanceRun(run, 'research', 'started', 2);
  run = advanceRun(run, 'decide', 'candidate', 3);
  run = pauseRun(run, 'approval', 4);
  assert.equal(run.paused, true);
  assert.equal(run.step, 'decide');
  run = resumeRun(run, 5);
  assert.equal(run.paused, false);
  assert.ok(run.events.length >= 3);
});

test('BotStateMachine wakes, advances, and blocks while paused', async () => {
  const machine = new BotStateMachine();
  const wake = await machine.handle(new Request('https://bot/wake', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ botId: 'bot_1', goal: 'shop' }),
  }), { CLUSTER: 'devnet' });
  assert.equal(wake.status, 200);
  const paused = await machine.handle(new Request('https://bot/pause', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'owner' }),
  }));
  assert.equal(paused.status, 200);
  const blocked = await machine.handle(new Request('https://bot/wake', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ botId: 'bot_1' }),
  }));
  assert.equal(blocked.status, 409);
  const resumed = await machine.handle(new Request('https://bot/resume', { method: 'POST' }));
  assert.equal(resumed.status, 200);
  const status = await machine.handle(new Request('https://bot/status'));
  const body = await status.json();
  assert.equal(body.run.botId, 'bot_1');
  assert.equal(body.run.paused, false);
});
