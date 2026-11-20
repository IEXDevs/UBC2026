import { proposalDigest } from './policy.mjs';

const ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const ADDRESS_2 = 'So11111111111111111111111111111111111111112';

export function proposal(overrides = {}) {
  return {
    id: 'p',
    botId: 'bot_1',
    cluster: 'mainnet-beta',
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
  /**
   * Achieves: Ask mode preview/reserve both stay approval-needed with zero reserved and no events.
   * Fails when: Reserve writes reserved>0 or events without an approval.
   * Oracle: snapshot.reserved === '0', reservations/events empty.
   * Side effects: none on deny (memory ledger unchanged).
   * Gaps: Preview vs reserve response field parity beyond state.
   */
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
  /**
   * Achieves: Approved ask-mode reserve debit=42 once; reused approvalId is blocked; one budget.reserved event.
   * Fails when: Double reserve on same approval, or events count ≠ 1.
   * Oracle: proposalDigest-backed approval; debit outflow+fee; snapshot.reserved === '42'.
   * Side effects: consumes approval, increments reserved, appends timeline event.
   * Gaps: Approval row usedAt persistence shape.
   */
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
  /**
   * Achieves: First auto reserve succeeds; second over same maxOutflow is over-budget with total-outflow.
   * Fails when: Second also reserves, or reserved totals both debits.
   * Oracle: Hand debit 58+2=60; second violations ['total-outflow'].
   * Side effects: reserved='60' after first only.
   * Gaps: per-transaction headroom when total still open.
   */
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
  /**
   * Achieves: Existing spent+reserved plus new debit trips both per-tx and total caps without adding reserve.
   * Fails when: Soft-accepts over-budget or mutates reserved away from prior '1'.
   * Oracle: debit '51'; violations both caps; reserved stays '1'.
   * Side effects: none on over-budget (no new hold).
   * Gaps: none for this arithmetic case.
   */
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
  /**
   * Achieves: Capped-automatic reserves at autoApproveCap and asks when the next debit would exceed it.
   * Fails when: Above-cap auto-reserves, or at-cap asks.
   * Oracle: autoApproveCap '42' matches first debit; second state approval-needed.
   * Side effects: reserved='42' after first.
   * Gaps: Fractional cap vs debit equality only at exact match.
   */
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
  /**
   * Achieves: Unlimited+ask still needs approval; unlimited+fully-automatic reserves.
   * Fails when: Unlimited ask auto-reserves, or unlimited automatic asks.
   * Oracle: Two fixture resets; states approval-needed vs reserved.
   * Side effects: second fixture reserved='42'.
   * Gaps: Unlimited + capped-automatic hybrid not covered.
   */
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
  /**
   * Achieves: Over-budget without override; approve-once allows one reserve past the cap.
   * Fails when: Plain reserve succeeds over budget, or approve-once still blocked.
   * Oracle: spent '80' vs maxOutflow '100'; approve-once → reserved.
   * Side effects: reserved='42' after override.
   * Gaps: Second approve-once reuse blocked is approval-consumption-owned (adjacent case).
   */
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
  /**
   * Achieves: Idempotent replay returns same digest without double reserve; mutated quote on same key throws.
   * Fails when: reserved doubles on replay, or mismatched quote silently replaces.
   * Oracle: replay.digest === first.digest; reserved stays '42'; idempotency-mismatch throw.
   * Side effects: single reservation row.
   * Gaps: Cross-process idempotency is Supabase-owned.
   */
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
  /**
   * Achieves: pauseBot blocks reserves with bot-disabled; resume restores spending and emits events.
   * Fails when: Pause still reserves, or resume leaves bot disabled.
   * Oracle: reason bot-disabled; events include bot.paused and bot.enabled.
   * Side effects: bot.enabled flag + timeline events.
   * Gaps: pause idempotency (second pause) not asserted.
   */
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
  /**
   * Achieves: freezeBot blocks with bot-frozen; resume while frozen fails; unfreeze leaves disabled until resume.
   * Fails when: Resume unfreezes implicitly, or spend works while frozen.
   * Oracle: reason codes bot-frozen then bot-disabled; final reserve succeeds after unfreeze+resume.
   * Side effects: frozen/enabled flags.
   * Gaps: freezeWallet interaction covered in adjacent case.
   */
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
  /**
   * Achieves: freezeWallet blocks only bots on that wallet; other wallet bots still reserve; unfreeze restores.
   * Fails when: bot_2 on other wallet is blocked, or bot_1 stays blocked after unfreeze.
   * Oracle: frozen.botIds === ['bot_1']; events wallet.frozen/unfrozen for bot_1 only.
   * Side effects: wallet.frozen flag + per-bot events.
   * Gaps: Multi-bot same wallet fan-out only checked for one assignee.
   */
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
  /**
   * Achieves: stopAll pauses only the caller's bots, writes kill.stop-all per bot, leaves other owners alone.
   * Fails when: user_2 bot is paused, or kill events ≠ 2 for user_1.
   * Oracle: botIds ['bot_1','bot_2']; user_2 bot stays enabled and can reserve.
   * Side effects: enabled=false for owner bots + kill events.
   * Gaps: stopAll while already paused idempotency.
   */
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
  /**
   * Achieves: At maxLoss reserve is blocked; one unit under maxLoss can still reserve.
   * Fails when: At-loss still reserves, or under-loss is blocked.
   * Oracle: realizedLoss '10' vs maxLoss '10' → max-loss-reached; '9' → reserved.
   * Side effects: none on block; reserved on allow.
   * Gaps: realizedLoss updates after fills are market-data-owned.
   */
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
  /**
   * Achieves: wrong-owner, quote-expired, asset mismatch soft-block; mainnet throws; reserved stays 0.
   * Fails when: Any illegal path reserves, or mainnet soft-blocks instead of throw.
   * Oracle: reason codes + /mainnet-beta or testnet/ throw; snapshot.reserved === '0'.
   * Side effects: none on rejects.
   * Gaps: testnet success path not reserved here (allowed by policy).
   */
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
        () => ledger.reserveBudget(reserveInput('idem_main', { cluster: 'devnet' })),
        /configured Solana cluster/,
      );
      assert.equal((await ledger.snapshot()).ledgers[0].reserved, '0');
    },
  },
];
