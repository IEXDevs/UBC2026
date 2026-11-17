import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapTransferRow, platformProposal, transferErrorCode, transferRequest } from './platform-transfer.mjs';

/**
 * Achieves: transferRequest normalizes handle/amount; zero amount rejected; proposal/map/error helpers behave.
 * Fails when: zero amount accepted, handle not lowercased, or direction wrong.
 * Oracle: null for amount 0; normalized deepEqual; proposal recipient @bob; map direction in; error code wallet_frozen.
 * Side effects / state checked: N/A.
 * Gaps: none
 */
test('a platform send request stays a handle and a base-unit amount', () => {
  assert.equal(transferRequest({ handle: '@Bob', amount: '0', idempotencyKey: 'send_bob_1' }), null);
  assert.deepEqual(transferRequest({
    handle: '@Bob',
    amount: '5000000',
    idempotencyKey: 'send_bob_5000000',
    botId: 'bot_shop',
  }), {
    handle: 'bob',
    amount: '5000000',
    idempotencyKey: 'send_bob_5000000',
    botId: 'bot_shop',
  });
  const proposal = platformProposal({
    ownerId: 'alice',
    botId: 'bot_shop',
    handle: 'bob',
    amount: '5000000',
    idempotencyKey: 'send_bob_5000000',
    now: 1_700_000_000_000,
  });
  assert.equal(proposal.proposal.recipient, '@bob');
  assert.equal(proposal.proposal.cluster, 'devnet');
  assert.equal(mapTransferRow({
    id: 'send_bob_5000000',
    handle: 'bob',
    amount: '5000000',
    from_owner_id: 'alice',
    to_owner_id: 'bob',
  }, 'bob').direction, 'in');
  assert.equal(transferErrorCode({ body: 'wallet_frozen' }), 'wallet_frozen');
});
