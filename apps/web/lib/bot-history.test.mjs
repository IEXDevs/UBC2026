import { test } from 'node:test';
import assert from 'node:assert/strict';
import { botHistoryRows, filterBotHistory } from './bot-history.mjs';

const bots = [
  { id: 'bot_meteora', name: 'Meteora' },
  { id: 'bot_shop', name: 'Sandbox shopper' },
];

const payments = [
  { id: 'small', botId: 'bot_shop', direction: 'paid', amount: '10000', asset: 'USDC', counterparty: 'catalog', protocol: 'x402', cluster: 'devnet' },
  { id: 'in', botId: 'bot_meteora', direction: 'earned', amount: '2000000', asset: 'USDC', counterparty: '@bob', protocol: 'x402', cluster: 'devnet' },
  { id: 'out', botId: 'bot_meteora', direction: 'paid', amount: '5000000', asset: 'USDC', counterparty: '@bob', protocol: 'x402', cluster: 'devnet' },
];

const transfers = [
  { id: 'send', botId: 'bot_meteora', handle: 'ada', amount: '1000000', direction: 'out' },
];

test('history rows keep the bot and the inflow or outflow', () => {
  const rows = botHistoryRows({ payments, transfers, bots });
  const meteora = rows.filter(row => row.botId === 'bot_meteora');
  assert.deepEqual(meteora.map(row => [row.id, row.direction, row.botName]), [
    ['in', 'in', 'Meteora'],
    ['out', 'out', 'Meteora'],
    ['send', 'out', 'Meteora'],
  ]);
});

test('filters keep one bot, one direction, and a minimum value', () => {
  const rows = botHistoryRows({ payments, transfers, bots });
  const filtered = filterBotHistory(rows, { botId: 'bot_meteora', flow: 'out', minUnits: '2000000' });
  assert.deepEqual(filtered.map(row => row.id), ['out']);
  assert.equal(filterBotHistory(rows, { flow: 'in' }).length, 1);
  assert.equal(filterBotHistory(rows, { botId: 'bot_shop' })[0].id, 'small');
  assert.equal(filterBotHistory(rows, { botId: 'bot_shop' })[0].badge, null);
});

test('a stream-confirmed payment keeps the confirmed badge', () => {
  const rows = botHistoryRows({
    payments: [{
      id: 'stream:sig',
      botId: 'bot_shop',
      direction: 'earned',
      amount: '10000',
      asset: 'USDC',
      counterparty: 'desk',
      protocol: 'x402',
      cluster: 'devnet',
      streamConfirmed: true,
      badge: 'confirmed',
    }],
    bots,
  });
  assert.equal(rows[0].badge, 'confirmed');
  assert.equal(rows[0].direction, 'in');
});
