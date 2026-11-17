import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  netChangeSummary,
  dollarsToBaseUnits,
  grantCovers,
  managesFunds,
  parsePermission,
  permissionInstruction,
  readAcceptanceAck,
  toolAccessKind,
  toolAccessRequest,
  transactionNeedsPerson,
  writeAcceptance,
} from './spend-permission.mjs';

/**
 * Achieves: verifies permission modes: full manages funds; ask/review still need a person; instructions match mode.
 * Fails when: unknown modes become full, full still needs a person, or ask instruction loses mainnet-quote warning.
 * Oracle: parsePermission('nope')→'ask'; managesFunds only for full; transactionNeedsPerson false only for full.
 * Side effects / state checked: N/A.
 * Gaps: none for permission helpers.
 */
test('full permissions manages funds and the other modes still wait', () => {
  assert.equal(parsePermission('full'), 'full');
  assert.equal(parsePermission('nope'), 'ask');
  assert.equal(managesFunds('full'), true);
  assert.equal(transactionNeedsPerson('full'), false);
  assert.equal(transactionNeedsPerson('ask'), true);
  assert.equal(transactionNeedsPerson('review'), true);
  assert.match(permissionInstruction('full'), /manage funds/);
  assert.match(permissionInstruction('full'), /Do not ask whether they are going to buy, sell, spend, or pay/);
  assert.match(permissionInstruction('review'), /review by AI/);
  assert.match(permissionInstruction('review'), /review threshold/);
  assert.match(permissionInstruction('ask'), /ask every time/);
  assert.match(permissionInstruction('ask'), /mainnet price quote never authorizes/);
  assert.equal(toolAccessKind('ask', 'web_search'), 'inline');
  assert.equal(toolAccessKind('ask', 'get_wallets'), 'inline');
  assert.equal(toolAccessKind('ask', 'request_spend'), 'modal');
  assert.equal(toolAccessKind('full', 'web_search'), null);
  assert.equal(toolAccessKind('full', 'request_spend'), 'modal');
  assert.equal(toolAccessKind('review', 'web_search'), null);
  assert.equal(toolAccessKind('', 'web_search'), null);
  const hold = toolAccessRequest('ask', 'web_search', { query: 'USDC rates' });
  assert.equal(hold.kind, 'inline');
  assert.match(hold.label, /USDC rates/);
  assert.equal(grantCovers([hold], 'web_search', { query: 'USDC rates' }), true);
  assert.equal(grantCovers([hold], 'web_search', { query: 'other' }), false);
  assert.match(toolAccessRequest('full', 'request_spend', { amount: '5000000', handle: 'bob' }).prompt, /Slide to confirm/);
});

/**
 * Achieves: verifies a send summary titles the handle and shows negative USDC net.
 * Fails when: title drops @handle, sign is positive, or net unit missing.
 * Oracle: amount 5e6 → signed −5; title Send to @bob; net −5 USDC.
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('onboarding stores the review maximum in base units', () => {
  assert.equal(dollarsToBaseUnits('25'), '25000000');
  assert.equal(dollarsToBaseUnits('0.5'), '500000');
  assert.equal(dollarsToBaseUnits('0'), null);
  const storage = new Map();
  const memory = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  writeAcceptance(memory, 'user_1', { permission: 'ask', reviewCap: '25000000' });
  assert.equal(readAcceptanceAck(memory, 'user_1'), true);
  assert.equal(memory.getItem('maelstrom.spendPermission'), 'ask');
  assert.equal(memory.getItem('maelstrom.reviewThreshold'), '25000000');
  assert.throws(() => writeAcceptance(memory, 'user_1', { permission: 'review', reviewCap: '0' }));
});

test('a send summary shows the outflow and the net', () => {
  const summary = netChangeSummary({ amount: '5000000', asset: 'USDC', handle: 'bob' });
  assert.equal(summary.title, 'Send to @bob');
  assert.deepEqual(summary.lines, [{ label: 'USDC', signed: '−5' }]);
  assert.equal(summary.net, '−5 USDC');
});

/**
 * Achieves: verifies swap legs keep each asset line while netting the USDC side.
 * Fails when: SOL line missing, USDC sign wrong, or net includes SOL.
 * Oracle: out 5 USDC + in SOL → lines −5 and SOL; net −5 USDC.
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('swap legs keep each asset and net the USDC side', () => {
  const summary = netChangeSummary({
    asset: 'USDC',
    legs: [
      { symbol: 'USDC', amount: '5000000', direction: 'out' },
      { symbol: 'SOL', amount: '21000000', direction: 'in' },
    ],
  });
  assert.equal(summary.lines[0].signed, '−5');
  assert.equal(summary.lines[1].label, 'SOL');
  assert.equal(summary.net, '−5 USDC');
});
