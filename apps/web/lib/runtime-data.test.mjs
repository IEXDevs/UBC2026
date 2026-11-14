import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyMoneyState, runtimeBaseUrl, shellBotFromRemote } from './runtime-data.mjs';

test('runtime base rejects junk and keeps origin', () => {
  assert.equal(runtimeBaseUrl(''), '');
  assert.equal(runtimeBaseUrl('not a url'), '');
  assert.equal(runtimeBaseUrl('https://maelstrom-agent-runtime.example.workers.dev/'), 'https://maelstrom-agent-runtime.example.workers.dev');
});

test('shell bot mapping never invents preview experience', () => {
  const bot = shellBotFromRemote({
    id: 'bot_1',
    name: 'Live',
    goal: 'Trade carefully',
    type: 'trading',
    walletId: 'w_main',
    ownerId: 'did:privy:x',
    enabled: true,
    frozen: false,
  }, { bot_1: { shape: 'hex', color: '#112233', name: 'Renamed' } });
  assert.equal(bot.name, 'Renamed');
  assert.equal(bot.shape, 'hex');
  assert.equal(bot.status, 'watching');
  assert.equal(bot.experience, undefined);
  assert.equal(shellBotFromRemote(null), null);
});

test('empty money state has no fake rows', () => {
  assert.deepEqual(emptyMoneyState(), { bots: [], wallets: [], payments: [], positions: [] });
});
