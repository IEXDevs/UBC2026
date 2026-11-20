import { test } from 'node:test';
import assert from 'node:assert/strict';
import { netTransactionFlows } from './tx-net.mjs';

const owner = 'Owner11111111111111111111111111111111111111';
const hopA = 'HopA111111111111111111111111111111111111111';
const hopB = 'HopB111111111111111111111111111111111111111';
const hopC = 'HopC111111111111111111111111111111111111111';
const usdc = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const sol = 'So11111111111111111111111111111111111111112';

function checked(sourceOwner, destinationOwner, mint, amount, decimals, nested) {
  const step = {
    parsed: {
      type: 'transferChecked',
      info: {
        authority: sourceOwner,
        destinationOwner,
        mint,
        tokenAmount: { amount, decimals },
      },
    },
  };
  if (nested) step.instructions = [nested];
  return step;
}

/**
 * Achieves: verifies nested inner transferChecked hops net to owner USDC out + SOL in only.
 * Fails when: intermediate hops appear as legs, deltas wrong, or leg count ≠ 2.
 * Oracle: owner→hopA USDC 5e6 out; hopC→owner SOL 2.1e7 in; legs.length === 2.
 * Side effects / state checked: N/A pure netting.
 * Gaps: only transferChecked; no system SOL balance / fee legs.
 */
test('a four-step swap nets to the owner start and end only', () => {
  const deepest = checked(hopC, owner, sol, '21000000', 9);
  const step3 = checked(hopB, hopC, usdc, '5000000', 6, deepest);
  const step2 = checked(hopA, hopB, usdc, '5000000', 6, step3);
  const step1 = checked(owner, hopA, usdc, '5000000', 6, step2);
  const legs = netTransactionFlows({
    instructions: [],
    meta: { innerInstructions: [{ instructions: [step1] }] },
  }, owner);
  const byMint = Object.fromEntries(legs.map(leg => [leg.mint, leg]));
  assert.equal(byMint[usdc].delta, '-5000000');
  assert.equal(byMint[usdc].direction, 'out');
  assert.equal(byMint[sol].delta, '21000000');
  assert.equal(byMint[sol].direction, 'in');
  assert.equal(legs.length, 2);
});

/**
 * Achieves: verifies pre/post token balances win over pool hops that never touch the owner.
 * Fails when: hop-only USDC volume becomes a leg or owner deltas ignore pre/post balances.
 * Oracle: owner USDC 10e6→5e6 (−5e6); SOL post 2.1e7 in; hopA↔hopB↔hopC ignored.
 * Side effects / state checked: N/A.
 * Gaps: does not cover missing decimals or non-owner pre/post rows.
 */
test('pre and post balances ignore pool hops that never touch the owner', () => {
  const legs = netTransactionFlows({
    meta: {
      preTokenBalances: [
        { mint: usdc, owner, uiTokenAmount: { amount: '10000000', decimals: 6 } },
      ],
      postTokenBalances: [
        { mint: usdc, owner, uiTokenAmount: { amount: '5000000', decimals: 6 } },
        { mint: sol, owner, uiTokenAmount: { amount: '21000000', decimals: 9 } },
      ],
      innerInstructions: [
        { instructions: [checked(hopA, hopB, usdc, '9000000', 6, checked(hopB, hopC, usdc, '9000000', 6))] },
      ],
    },
  }, owner);
  assert.equal(legs.find(leg => leg.mint === usdc).delta, '-5000000');
  assert.equal(legs.find(leg => leg.mint === sol).delta, '21000000');
});
