import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSignalOffer, signalSaleFeedEntry } from './commerce.mjs';

const payTo = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const feePayer = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const buyer = 'So11111111111111111111111111111111111111112';

test('builds a devnet x402 challenge for a bot signal sale', () => {
  const offer = buildSignalOffer({
    botId: 'bot_1',
    walletAddress: payTo,
    feePayer,
    resourceUrl: 'https://api.maelstrom.local/signals/apy-1',
    amount: '25000',
    signalId: 'apy-1',
  });
  assert.equal(offer.challenge.status, 402);
  assert.equal(offer.direction, 'earned');
  const feed = signalSaleFeedEntry({
    id: 'pay_1',
    botId: 'bot_1',
    buyer,
    amount: '25000',
    resourceUrl: 'https://api.maelstrom.local/signals/apy-1',
    createdAt: 1,
  });
  assert.equal(feed.status, 'requested');
  assert.equal(feed.protocol, 'x402-v2');
});
