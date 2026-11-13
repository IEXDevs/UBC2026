import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBot, evaluateProposal, validateApproval, proposalDigest, raiseLimits } from './policy.mjs';
const bot = { id:'b', ownerId:'u', name:'Shop', goal:'Compare products', type:'shopping', enabled:true, policyVersion:1, cap:{mode:'limited',asset:'USDC',maxOutflow:'100',maxPerTransaction:'50'} };
const p = { id:'p', botId:'b', cluster:'devnet', asset:'USDC', recipient:'merchant', quoteId:'q', outflow:'40', maxFee:'2', expectedReceive:'1', expectedReceiveAsset:'gift-card', expiresAt:2000 };
const ledger = {asset:'USDC',spent:'0',reserved:'0',realizedLoss:'0'};
const approval = {ownerId:'u',botId:'b',policyVersion:1,digest:proposalDigest(p),action:'approve',expiresAt:1500};
const check = (overrides={}) => validateApproval({bot,proposal:p,ledger,approval,now:1000,...overrides});
test('bot requires type and explicit cap decision', () => {
  assert.throws(()=>validateBot({...bot,type:undefined}));
  assert.throws(()=>validateBot({...bot,cap:undefined}));
  assert.throws(()=>validateBot({...bot,cap:{...bot.cap,maxOutflow:100}}));
});
test('normal and unlimited budgets still require manual approval', () => {
  assert.equal(evaluateProposal(bot,p,ledger,1000).state,'approval-needed');
  assert.equal(evaluateProposal({...bot,cap:{mode:'unlimited',asset:'USDC'}},p,ledger,1000).state,'approval-needed');
  assert.equal(check({approval:undefined}).reason,'invalid-approval');
});
test('fees and reservations count toward limits with exact integer arithmetic', () => {
  const decision=evaluateProposal(bot,{...p,outflow:'49'}, {...ledger,spent:'50',reserved:'1'},1000);
  assert.deepEqual(decision.violations,['per-transaction','total-outflow']);
  assert.equal(decision.debit,'51');
});
test('mainnet, wrong bot and malformed amounts are rejected', () => {
  for (const change of [{cluster:'mainnet-beta'},{botId:'other'},{outflow:'1.2'},{maxFee:'-1'}]) assert.throws(()=>evaluateProposal(bot,{...p,...change},ledger,1000));
});
test('kill switch and quote expiry block approval', () => {
  assert.equal(check({bot:{...bot,enabled:false}}).reason,'bot-disabled');
  assert.equal(check({now:2000}).reason,'quote-expired');
});
test('approval binds owner, version, quote, amounts, recipient and expiry', () => {
  assert.equal(check().state,'ready-to-reserve');
  for (const change of [{ownerId:'other'},{policyVersion:2},{usedAt:900},{expiresAt:1000},{expiresAt:3000}]) assert.equal(check({approval:{...approval,...change}}).state,'blocked');
  for (const change of [{recipient:'attacker'},{outflow:'41'},{expectedReceive:'2'},{quoteId:'new'}]) assert.equal(check({proposal:{...p,...change}}).reason,'invalid-approval');
});
test('budget override is explicit and applies only to the approved proposal', () => {
  const full={...ledger,spent:'80'};
  assert.equal(check({ledger:full}).reason,'budget-override-required');
  assert.equal(check({ledger:full,approval:{...approval,action:'approve-once'}}).state,'ready-to-reserve');
  assert.equal(bot.cap.maxOutflow,'100');
});
test('raising limits invalidates earlier approvals', () => {
  const next=raiseLimits(bot,{...bot.cap,maxOutflow:'200'});
  assert.equal(next.policyVersion,2);
  assert.equal(check({bot:next}).reason,'invalid-approval');
  assert.throws(()=>raiseLimits(bot,{...bot.cap,maxOutflow:'99'}));
});
test('position manager stops at max loss and accounting asset must match', () => {
  const manager={...bot,type:'position-management',cap:{mode:'limited',asset:'USDC',maxLoss:'10'}};
  assert.equal(evaluateProposal(manager,p,{...ledger,realizedLoss:'10'},1000).reason,'max-loss-reached');
  assert.equal(evaluateProposal(bot,{...p,asset:'SOL'},ledger,1000).reason,'accounting-asset-mismatch');
});
