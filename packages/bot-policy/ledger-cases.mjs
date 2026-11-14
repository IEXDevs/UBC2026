import { proposalDigest } from './policy.mjs';

const ADDRESS = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const ADDRESS_2 = 'So11111111111111111111111111111111111111112';

export function proposal(overrides = {}) {
  return {
    id: 'p',
    botId: 'bot_1',
    cluster: 'devnet',
    asset: 'USDC',
    recipient: 'merchant',
    quoteId: 'q',
    outflow: '40',
    maxFee: '2',
    expectedReceive: '1',
    expectedReceiveAsset: 'gift-card',
    expiresAt: 2000,
    ...overrides,
  };
}

function wallet(id, ownerId, extra = {}) {
  return { id, ownerId, kind: 'main', label: id, address: ADDRESS, frozen: false, provider: 'privy', ...extra };
}

export function shoppingFixture(bot = {}, ledger = {}) {
  return {
    users: [{ id: 'user_1', privyUserId: 'did:privy:user_1' }],
    wallets: [wallet('w_main', 'user_1', { label: 'Main' })],
    bots: [{
      id: 'bot_1',
      ownerId: 'user_1',
      walletId: 'w_main',
      name: 'Shop',
      goal: 'Compare products',
      type: 'shopping',
      approvalMode: 'ask',
      enabled: true,
      frozen: false,
      policyVersion: 1,
      ...bot,
      cap: { mode: 'limited', asset: 'USDC', maxOutflow: '100', maxPerTransaction: '50', ...bot.cap },
    }],
    ledgers: [{ botId: 'bot_1', asset: 'USDC', spent: '0', reserved: '0', realizedLoss: '0', ...ledger }],
    approvals: [],
  };
}

function approval(digest, extra = {}) {
  return {
    id: 'appr_1',
    ownerId: 'user_1',
    botId: 'bot_1',
    digest,
    policyVersion: 1,
    action: 'approve',
    expiresAt: 1500,
    usedAt: null,
    ...extra,
  };
}

function reserveInput(idempotencyKey, proposalOverrides = {}, extra = {}) {
  return { ownerId: 'user_1', now: 1000, idempotencyKey, proposal: proposal(proposalOverrides), ...extra };
}

export const ledgerCases = [
  {
    name: 'ask mode previews and does not reserve without approval',
    async run(ledger, assert) {
      await ledger.reset(shoppingFixture());
      const preview = await ledger.preview(reserveInput('idem_1'));
      assert.equal(preview.state, 'approval-needed');
      const result = await ledger.reserveBudget(reserveInput('idem_1'));
      assert.equal(result.state, 'approval-needed');
      assert.equal(result.replay, false);
      const snap = await ledger.snapshot();
      assert.equal(snap.ledgers[0].reserved, '0');
      assert.equal(snap.reservations.length, 0);
      assert.equal(snap.events.length, 0);
    },
  },
  {
    name: 'ask mode reserves once and consumes the approval',
    async run(ledger, assert) {
      const quote = proposal();
      const fixture = shoppingFixture();
      fixture.approvals.push(approval(proposalDigest(quote)));
      await ledger.reset(fixture);
      const result = await ledger.reserveBudget(reserveInput('idem_1', {}, { approvalId: 'appr_1' }));
      assert.equal(result.state, 'reserved');
      assert.equal(result.replay, false);
      assert.equal(result.debit, '42');
      const again = await ledger.reserveBudget(reserveInput('idem_2', { id: 'p2' }, { approvalId: 'appr_1' }));
      assert.equal(again.state, 'blocked');
      assert.equal(again.reason, 'invalid-approval');
      const snap = await ledger.snapshot();
      assert.equal(snap.ledgers[0].reserved, '42');
      assert.equal(snap.events.filter(event => event.kind === 'budget.reserved').length, 1);
    },
  },
  {
    name: 'fully automatic reserves inside the cap and blocks the next hold',
    async run(ledger, assert) {
      await ledger.reset(shoppingFixture({ approvalMode: 'fully-automatic', cap: { maxPerTransaction: '80' } }));
      const first = await ledger.reserveBudget(reserveInput('idem_1', { id: 'p1', outflow: '58' }));
      const second = await ledger.reserveBudget(reserveInput('idem_2', { id: 'p2', outflow: '58' }));
      assert.equal(first.state, 'reserved');
      assert.equal(first.debit, '60');
      assert.equal(second.state, 'over-budget');
      assert.deepEqual(second.violations, ['total-outflow']);
      assert.equal((await ledger.snapshot()).ledgers[0].reserved, '60');
    },
  },
  {
    name: 'fees and existing holds count toward both caps',
    async run(ledger, assert) {
      await ledger.reset(shoppingFixture({ approvalMode: 'fully-automatic' }, { spent: '50', reserved: '1' }));
      const result = await ledger.reserveBudget(reserveInput('idem_fees', { outflow: '49' }));
      assert.equal(result.state, 'over-budget');
      assert.equal(result.debit, '51');
      assert.deepEqual(result.violations, ['per-transaction', 'total-outflow']);
      assert.equal((await ledger.snapshot()).ledgers[0].reserved, '1');
    },
  },
  {
    name: 'capped automatic reserves up to its cap and asks above it',
    async run(ledger, assert) {
      await ledger.reset(shoppingFixture({ approvalMode: 'capped-automatic', autoApproveCap: '42' }));
      const atCap = await ledger.reserveBudget(reserveInput('idem_at'));
      assert.equal(atCap.state, 'reserved');
      const above = await ledger.reserveBudget(reserveInput('idem_above', { id: 'p2', outflow: '41' }));
      assert.equal(above.state, 'approval-needed');
      assert.equal((await ledger.snapshot()).ledgers[0].reserved, '42');
    },
  },
  {
    name: 'unlimited ask still needs approval and unlimited automatic reserves',
    async run(ledger, assert) {
      await ledger.reset(shoppingFixture({ cap: { mode: 'unlimited', asset: 'USDC', maxOutflow: undefined, maxPerTransaction: undefined } }));
      const ask = await ledger.reserveBudget(reserveInput('idem_ask'));
      assert.equal(ask.state, 'approval-needed');
      await ledger.reset(shoppingFixture({
        approvalMode: 'fully-automatic',
        cap: { mode: 'unlimited', asset: 'USDC', maxOutflow: undefined, maxPerTransaction: undefined },
      }));
      const auto = await ledger.reserveBudget(reserveInput('idem_auto'));
      assert.equal(auto.state, 'reserved');
      assert.equal((await ledger.snapshot()).ledgers[0].reserved, '42');
    },
  },
  {
    name: 'approve-once can reserve past the outflow cap a single time',
    async run(ledger, assert) {
      const quote = proposal();
      const fixture = shoppingFixture({}, { spent: '80' });
      fixture.approvals.push(approval(proposalDigest(quote), { action: 'approve-once' }));
      await ledger.reset(fixture);
      const blocked = await ledger.reserveBudget(reserveInput('idem_no'));
      assert.equal(blocked.state, 'over-budget');
      const allowed = await ledger.reserveBudget(reserveInput('idem_yes', {}, { approvalId: 'appr_1' }));
      assert.equal(allowed.state, 'reserved');
      assert.equal((await ledger.snapshot()).ledgers[0].reserved, '42');
    },
  },
  {
    name: 'replay does not double-reserve and a reused key cannot change the quote',
    async run(ledger, assert) {
      await ledger.reset(shoppingFixture({ approvalMode: 'fully-automatic' }));
      const first = await ledger.reserveBudget(reserveInput('idem_1'));
      const replay = await ledger.reserveBudget(reserveInput('idem_1'));
      assert.equal(first.state, 'reserved');
      assert.equal(replay.replay, true);
      assert.equal(replay.digest, first.digest);
      assert.equal((await ledger.snapshot()).ledgers[0].reserved, '42');
      await assert.rejects(
        () => ledger.reserveBudget(reserveInput('idem_1', { id: 'other' })),
        /idempotency-mismatch/,
      );
      assert.equal((await ledger.snapshot()).ledgers[0].reserved, '42');
    },
  },
  {
    name: 'pause blocks spending until resume',
    async run(ledger, assert) {
      await ledger.reset(shoppingFixture({ approvalMode: 'fully-automatic' }));
      const paused = await ledger.pauseBot({ ownerId: 'user_1', botId: 'bot_1', now: 1000 });
      assert.equal(paused.changed, true);
      const denied = await ledger.reserveBudget(reserveInput('idem_paused'));
      assert.equal(denied.reason, 'bot-disabled');
      await ledger.resumeBot({ ownerId: 'user_1', botId: 'bot_1', now: 1001 });
      const allowed = await ledger.reserveBudget(reserveInput('idem_resumed'));
      assert.equal(allowed.state, 'reserved');
      const snap = await ledger.snapshot();
      assert.equal(snap.bots[0].enabled, true);
      assert.equal(snap.bots[0].frozen, false);
      assert.ok(snap.events.some(event => event.kind === 'bot.paused'));
      assert.ok(snap.events.some(event => event.kind === 'bot.enabled'));
    },
  },
  {
    name: 'freeze holds a bot until unfreeze and a fresh resume',
    async run(ledger, assert) {
      await ledger.reset(shoppingFixture({ approvalMode: 'fully-automatic' }));
      await ledger.freezeBot({ ownerId: 'user_1', botId: 'bot_1', now: 1000 });
      const frozen = await ledger.reserveBudget(reserveInput('idem_frozen'));
      assert.equal(frozen.reason, 'bot-frozen');
      const resume = await ledger.resumeBot({ ownerId: 'user_1', botId: 'bot_1', now: 1001 });
      assert.equal(resume.reason, 'bot-frozen');
      await ledger.unfreezeBot({ ownerId: 'user_1', botId: 'bot_1', now: 1002 });
      const stillPaused = await ledger.reserveBudget(reserveInput('idem_paused'));
      assert.equal(stillPaused.reason, 'bot-disabled');
      await ledger.resumeBot({ ownerId: 'user_1', botId: 'bot_1', now: 1003 });
      const allowed = await ledger.reserveBudget(reserveInput('idem_go'));
      assert.equal(allowed.state, 'reserved');
    },
  },
  {
    name: 'freezing a wallet blocks every assigned bot and leaves other wallets alone',
    async run(ledger, assert) {
      const fixture = shoppingFixture({ approvalMode: 'fully-automatic' });
      fixture.wallets.push(wallet('w_other', 'user_1', { kind: 'additional', label: 'Other', address: ADDRESS_2 }));
      fixture.bots.push({
        id: 'bot_2',
        ownerId: 'user_1',
        walletId: 'w_other',
        name: 'Other',
        goal: 'Other',
        type: 'shopping',
        approvalMode: 'fully-automatic',
        enabled: true,
        frozen: false,
        policyVersion: 1,
        cap: { mode: 'limited', asset: 'USDC', maxOutflow: '100', maxPerTransaction: '50' },
      });
      fixture.ledgers.push({ botId: 'bot_2', asset: 'USDC', spent: '0', reserved: '0', realizedLoss: '0' });
      await ledger.reset(fixture);
      const frozen = await ledger.freezeWallet({ ownerId: 'user_1', walletId: 'w_main', now: 1000 });
      assert.deepEqual(frozen.botIds, ['bot_1']);
      const blocked = await ledger.reserveBudget(reserveInput('idem_main'));
      assert.equal(blocked.reason, 'wallet-frozen');
      const other = await ledger.reserveBudget(reserveInput('idem_other', { id: 'p2', botId: 'bot_2' }));
      assert.equal(other.state, 'reserved');
      await ledger.unfreezeWallet({ ownerId: 'user_1', walletId: 'w_main', now: 1001 });
      const allowed = await ledger.reserveBudget(reserveInput('idem_after'));
      assert.equal(allowed.state, 'reserved');
      const snap = await ledger.snapshot();
      assert.equal(snap.wallets.find(row => row.id === 'w_main').frozen, false);
      assert.ok(snap.events.some(event => event.kind === 'wallet.frozen' && event.botId === 'bot_1'));
      assert.ok(snap.events.some(event => event.kind === 'wallet.unfrozen' && event.botId === 'bot_1'));
    },
  },
  {
    name: 'stop all pauses every bot the owner has and writes a kill event',
    async run(ledger, assert) {
      const fixture = shoppingFixture({ approvalMode: 'fully-automatic' });
      fixture.users.push({ id: 'user_2', privyUserId: 'did:privy:user_2' });
      fixture.wallets.push(wallet('w_2', 'user_2', { label: 'Theirs' }));
      fixture.bots.push({
        id: 'bot_2',
        ownerId: 'user_1',
        walletId: 'w_main',
        name: 'Second',
        goal: 'Second',
        type: 'trading',
        approvalMode: 'fully-automatic',
        enabled: true,
        frozen: false,
        policyVersion: 1,
        cap: { mode: 'limited', asset: 'USDC', maxOutflow: '100', maxPerTransaction: '50' },
      });
      fixture.bots.push({
        id: 'bot_other',
        ownerId: 'user_2',
        walletId: 'w_2',
        name: 'Theirs',
        goal: 'Theirs',
        type: 'trading',
        approvalMode: 'fully-automatic',
        enabled: true,
        frozen: false,
        policyVersion: 1,
        cap: { mode: 'limited', asset: 'USDC', maxOutflow: '100', maxPerTransaction: '50' },
      });
      fixture.ledgers.push(
        { botId: 'bot_2', asset: 'USDC', spent: '0', reserved: '0', realizedLoss: '0' },
        { botId: 'bot_other', asset: 'USDC', spent: '0', reserved: '0', realizedLoss: '0' },
      );
      await ledger.reset(fixture);
      const stopped = await ledger.stopAll({ ownerId: 'user_1', now: 1000 });
      assert.deepEqual(stopped.botIds, ['bot_1', 'bot_2']);
      const snap = await ledger.snapshot();
      assert.equal(snap.bots.find(bot => bot.id === 'bot_1').enabled, false);
      assert.equal(snap.bots.find(bot => bot.id === 'bot_2').enabled, false);
      assert.equal(snap.bots.find(bot => bot.id === 'bot_other').enabled, true);
      assert.equal(snap.events.filter(event => event.kind === 'kill.stop-all').length, 2);
      const denied = await ledger.reserveBudget(reserveInput('idem_stopped'));
      assert.equal(denied.reason, 'bot-disabled');
      const theirs = await ledger.reserveBudget({
        ownerId: 'user_2',
        now: 1000,
        idempotencyKey: 'idem_theirs',
        proposal: proposal({ id: 'pt', botId: 'bot_other' }),
      });
      assert.equal(theirs.state, 'reserved');
    },
  },
  {
    name: 'position manager stops at max loss',
    async run(ledger, assert) {
      const fixture = shoppingFixture({
        type: 'position-management',
        approvalMode: 'fully-automatic',
        cap: { mode: 'limited', asset: 'USDC', maxLoss: '10', maxOutflow: undefined, maxPerTransaction: undefined },
      });
      fixture.ledgers[0].realizedLoss = '10';
      await ledger.reset(fixture);
      const stopped = await ledger.reserveBudget(reserveInput('idem_loss'));
      assert.equal(stopped.reason, 'max-loss-reached');
      fixture.ledgers[0].realizedLoss = '9';
      await ledger.reset(fixture);
      const allowed = await ledger.reserveBudget(reserveInput('idem_ok'));
      assert.equal(allowed.state, 'reserved');
    },
  },
  {
    name: 'wrong owner, expired quote, asset mismatch, and mainnet are rejected',
    async run(ledger, assert) {
      await ledger.reset(shoppingFixture({ approvalMode: 'fully-automatic' }));
      const wrong = await ledger.reserveBudget({ ...reserveInput('idem_wrong'), ownerId: 'user_2' });
      assert.equal(wrong.reason, 'wrong-owner');
      const expired = await ledger.reserveBudget(reserveInput('idem_expired', {}, { now: 2000 }));
      assert.equal(expired.reason, 'quote-expired');
      const asset = await ledger.reserveBudget(reserveInput('idem_asset', { asset: 'SOL' }));
      assert.equal(asset.reason, 'accounting-asset-mismatch');
      await assert.rejects(
        () => ledger.reserveBudget(reserveInput('idem_main', { cluster: 'mainnet-beta' })),
        /devnet or testnet/,
      );
      assert.equal((await ledger.snapshot()).ledgers[0].reserved, '0');
    },
  },
];
