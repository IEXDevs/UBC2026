import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  accountSetupStep,
  SETUP_CARD_MS,
  setupCardVisible,
  chartLine,
  createRecoveryPhrase,
  deskTokens,
  displayToUnits,
  normalizeTokenPrefs,
  parseImportKey,
  parseSendTarget,
  phraseComplete,
  phraseMatches,
  swapDraft,
  swapSendSettlement,
  phraseFromEntropy,
  quoteUrl,
  readQuoteOut,
  readRecoveryAck,
  recoveryAcknowledged,
  recoveryAckRecord,
  recoveryCard,
  recoveryResume,
  recoveryStepRecord,
  recoveryWords,
  shuffledPhrase,
  SOL_MINT,
  swapQuoteUrl,
  USDC_MINT,
  verifyRecoveryPhrase,
  writeRecoveryAck,
} from './wallet-desk.mjs';

const ADDRESS = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const PHRASE = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima'];

/**
 * Achieves: verifies token prefs keep USDC visible and tradeable.
 * Fails when: token prefs keep USDC visible and tradeable breaks (e.g. expected ['SOL'], ['SOL'], 1).
 * Oracle: assert.equal(prefs.extra.length, 1); assert.equal(prefs.extra[0].symbol, 'BONK'); assert.equal(prefs.sns, 'richclub.sol'); assert.deepEqual(prefs.hidden, ['SOL']); assert.deepEqual(prefs.restricted, ['SOL'])
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('token prefs keep USDC visible and tradeable', () => {
  const prefs = normalizeTokenPrefs({
    hidden: ['USDC', 'SOL', 'nope'],
    restricted: ['USDC', 'SOL'],
    extra: [
      { symbol: 'bonk', mint: ADDRESS, decimals: 5 },
      { symbol: 'BONK', mint: ADDRESS, decimals: 5 },
      { symbol: 'BAD', mint: 'not-a-mint', decimals: 6 },
    ],
    sns: 'RichClub.sol',
  });
  assert.deepEqual(prefs.hidden, ['SOL']);
  assert.deepEqual(prefs.restricted, ['SOL']);
  assert.equal(prefs.extra.length, 1);
  assert.equal(prefs.extra[0].symbol, 'BONK');
  assert.equal(prefs.sns, 'richclub.sol');
});

/**
 * Achieves: verifies desk tokens use the platform USDC book and hide nothing by default.
 * Fails when: desk tokens use the platform USDC book and hide nothing by default breaks (e.g. expected 'USDC', '4 USDC', false).
 * Oracle: assert.equal(rows[0].symbol, 'USDC'); assert.equal(rows[0].amountLabel, '4 USDC'); assert.equal(rows[0].hidden, false); assert.equal(rows[0].tradeable, true); assert.equal(rows[1].amountLabel, '1 SOL'); assert.equal(rows[1].hidden, true)
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('desk tokens use the platform USDC book and hide nothing by default', () => {
  const rows = deskTokens({
    transfers: [
      { asset: 'USDC', amount: '5000000', direction: 'in' },
      { asset: 'USDC', amount: '1000000', direction: 'out' },
    ],
    positions: [{ asset: 'SOL', amount: '1000000000', side: 'long' }],
    prefs: { hidden: ['SOL'] },
  });
  assert.equal(rows[0].symbol, 'USDC');
  assert.equal(rows[0].amountLabel, '4 USDC');
  assert.equal(rows[0].hidden, false);
  assert.equal(rows[0].tradeable, true);
  assert.equal(rows[1].amountLabel, '1 SOL');
  assert.equal(rows[1].hidden, true);
});

/**
 * Achieves: desk SOL and USDC follow the confirmed devnet read, and a token with no ledger row stays listed.
 * Fails when: the platform book hides the faucet amount, or an on-wallet token is dropped.
 * Oracle: 20 USDC and 1 SOL from devnet; BONK row present with empty positions and transfers.
 * Side effects / state checked: N/A.
 * Gaps: does not call RPC.
 */
test('desk tokens show unavailable labels on rpc_failed instead of inventing zeros', () => {
  const rows = deskTokens({
    transfers: [],
    positions: [],
    devnet: {
      ok: false,
      code: 'rpc_failed',
      cluster: 'devnet',
      solLamports: null,
      usdcAmount: null,
      tokens: [],
    },
  });
  assert.equal(rows[0].symbol, 'USDC');
  assert.equal(rows[0].amount, null);
  assert.equal(rows[0].amountKnown, false);
  assert.match(rows[0].amountLabel, /USDC unavailable \(rpc_failed\)/);
  assert.equal(rows[0].amountLabel.includes('0 USDC'), false);
  assert.equal(rows[1].symbol, 'SOL');
  assert.equal(rows[1].amount, null);
  assert.match(rows[1].amountLabel, /SOL unavailable/);
  assert.equal(rows[1].balanceStatus, 'rpc_failed');
});

test('desk tokens show partial known SOL with unavailable USDC', () => {
  const rows = deskTokens({
    transfers: [],
    positions: [],
    devnet: {
      ok: false,
      code: 'rpc_failed',
      cluster: 'devnet',
      solLamports: '2500000000',
      usdcAmount: null,
      tokens: [],
    },
  });
  // Failed overall read must not invent a zero USDC book from empty positions.
  assert.equal(rows[0].amount, null);
  assert.match(rows[0].amountLabel, /unavailable/);
  // Known SOL amount is still shown when present on a failed/partial body.
  assert.equal(rows[1].amount, '2500000000');
  assert.equal(rows[1].amountLabel, '2.5 SOL');
  assert.equal(rows[1].amountKnown, true);
});

test('desk tokens show devnet SOL and USDC even when the ledger is empty', () => {
  const bonk = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
  const rows = deskTokens({
    transfers: [{ asset: 'USDC', amount: '4000000', direction: 'in' }],
    positions: [],
    devnet: {
      ok: true,
      cluster: 'devnet',
      solLamports: '1000000000',
      usdcAmount: '20000000',
      tokens: [
        { mint: USDC_MINT, symbol: 'USDC', amount: '20000000', decimals: 6 },
        { mint: bonk, symbol: 'JUP', amount: '3000000', decimals: 6 },
      ],
    },
  });
  assert.equal(rows[0].amountLabel, '20 USDC');
  assert.equal(rows[1].amountLabel, '1 SOL');
  const extra = rows.find(row => row.symbol === 'JUP');
  assert.equal(extra.amountLabel, '3 JUP');
  assert.equal(extra.mint, bonk);
});

/**
 * Achieves: verifies send targets accept a handle, an SNS name, or an address.
 * Fails when: send targets accept a handle, an SNS name, or an address breaks (e.g. expected { kind: 'handle', handle: 'alex' }, { kind: 'sns', domain: 'richclub.sol' }, { kind: 'address', address: ADDRESS }); failure/null paths flip.
 * Oracle: assert.equal(parseSendTarget('hello there'), null); assert.deepEqual(parseSendTarget('@Alex'), { kind: 'handle', handle: 'alex' }); assert.deepEqual(parseSendTarget('richclub.sol'), { kind: 'sns', domain: 'richclub.sol' }); assert.deepEqual(parseSendTarget(ADDRESS), { kind: 'address', address: ADDRESS })
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('send targets accept a handle, an SNS name, or an address', () => {
  assert.deepEqual(parseSendTarget('@Alex'), { kind: 'handle', handle: 'alex' });
  assert.deepEqual(parseSendTarget('richclub.sol'), { kind: 'sns', domain: 'richclub.sol' });
  assert.deepEqual(parseSendTarget(ADDRESS), { kind: 'address', address: ADDRESS });
  assert.equal(parseSendTarget('hello there'), null);
});

/**
 * Achieves: a mistyped pubkey is flagged before the slide, not treated as a blank To field.
 * Fails when: invalid base58 / wrong length collapses to null, or a short draft is marked invalid.
 * Oracle: 0OIl typo → invalid-address; too-short base58 → null; valid ADDRESS stays address.
 * Side effects / state checked: N/A.
 * Gaps: does not check on-chain account existence.
 */
test('a mistyped wallet address is flagged as invalid', () => {
  assert.deepEqual(parseSendTarget('4zMMC0srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'), { kind: 'invalid-address' });
  assert.deepEqual(parseSendTarget('A'.repeat(50)), { kind: 'invalid-address' });
  assert.equal(parseSendTarget('hi there'), null);
  assert.deepEqual(parseSendTarget(ADDRESS), { kind: 'address', address: ADDRESS });
});

/**
 * Achieves: verifies display amounts become base units.
 * Fails when: display amounts become base units breaks (e.g. expected 6, 9, 6); failure/null paths flip.
 * Oracle: assert.equal(displayToUnits('1.5', 6); assert.equal(displayToUnits('0.000000001', 9); assert.equal(displayToUnits('0', 6); assert.equal(displayToUnits('1.1234567', 6)
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('display amounts become base units', () => {
  assert.equal(displayToUnits('1.5', 6), '1500000');
  assert.equal(displayToUnits('0.000000001', 9), '1');
  assert.equal(displayToUnits('0', 6), null);
  assert.equal(displayToUnits('1.1234567', 6), null);
});

/**
 * Achieves: verifies a price series becomes one line and a filled area.
 * Fails when: a price series becomes one line and a filled area breaks (e.g. expected true, /^M/, /Z$/); failure/null paths flip.
 * Oracle: assert.equal(line.up, true); assert.equal(chartLine([1]), null); assert.match(line.d, /^M/); assert.match(line.area, /Z$/)
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('a price series becomes one line and a filled area', () => {
  const line = chartLine([2, 1, 3], 100, 40);
  assert.equal(line.up, true);
  assert.match(line.d, /^M/);
  assert.match(line.area, /Z$/);
  assert.equal(chartLine([1]), null);
});

/**
 * Achieves: verifies quotes stay on the public Jupiter or DFlow read endpoints.
 * Fails when: quotes stay on the public Jupiter or DFlow read endpoints breaks (e.g. expected /^https:\/\/lite-api\.jup\.ag\/swap\/v1\/quote\?/, /^https:\/\/quote-api\.dflow\.net\/quote\?/, { inputMint: USDC_MINT, outputMint: USDC_MINT, amount: '1' }); failure/null paths flip.
 * Oracle: assert.equal(quoteUrl('jupiter', { inputMint: USDC_MINT, outputMint: USDC_MINT, amount: '1' }); assert.equal(readQuoteOut({ outAmount: '42' }), '42'); assert.equal(readQuoteOut({ outAmount: '1.2' }), null); assert.match(jupiter, /^https:\/\/lite-api\.jup\.ag\/swap\/v1\/quote\?/); assert.match(dflow, /^https:\/\/quote-api\.dflow\.net\/quote\?/)
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('quotes stay on the public Jupiter or DFlow read endpoints', () => {
  const jupiter = quoteUrl('jupiter', { inputMint: USDC_MINT, outputMint: SOL_MINT, amount: '1000000' });
  const dflow = quoteUrl('dflow', { inputMint: USDC_MINT, outputMint: SOL_MINT, amount: '1000000' });
  assert.match(jupiter, /^https:\/\/lite-api\.jup\.ag\/swap\/v1\/quote\?/);
  assert.match(dflow, /^https:\/\/quote-api\.dflow\.net\/quote\?/);
  assert.equal(quoteUrl('jupiter', { inputMint: USDC_MINT, outputMint: USDC_MINT, amount: '1' }), null);
  assert.equal(readQuoteOut({ outAmount: '42' }), '42');
  assert.equal(readQuoteOut({ outAmount: '1.2' }), null);
});

/**
 * Achieves: verifies recovery phrases are confirmed in order and never stored in the ack.
 * Fails when: recovery phrases are confirmed in order and never stored in the ack breaks (e.g. expected PHRASE, 'alpha'], 12); failure/null paths flip.
 * Oracle: assert.equal(recoveryWords(['alpha', 'alpha']); assert.equal(shuffled.length, 12); assert.equal(phraseMatches(PHRASE.join(' '), PHRASE); assert.equal(phraseMatches('alpha bravo', PHRASE); assert.equal(phraseComplete([0, 1, 2], 3); assert.equal(phraseComplete([0, 2, 1], 3)
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('recovery phrases are confirmed in order and never stored in the ack', () => {
  assert.deepEqual(recoveryWords(PHRASE.join(' ')), PHRASE);
  assert.equal(recoveryWords(['alpha', 'alpha']), null);
  const shuffled = shuffledPhrase(PHRASE, () => 0);
  assert.equal(shuffled.length, 12);
  assert.notEqual(shuffled[0].index, 0);
  assert.equal(phraseMatches(PHRASE.join(' '), PHRASE), true);
  assert.equal(phraseMatches('alpha bravo', PHRASE), false);
  assert.equal(phraseComplete([0, 1, 2], 3), true);
  assert.equal(phraseComplete([0, 2, 1], 3), false);
  const card = recoveryCard({
    words: PHRASE,
    wallets: [{ label: 'Main', address: ADDRESS }],
    handle: 'alex',
  });
  assert.match(card, /alpha bravo/);
  assert.match(card, /Main: 4zMMC/);
  assert.match(card, /@alex/);
  const plain = recoveryCard({ wallets: [{ label: 'Main', address: ADDRESS }] });
  assert.match(plain, /Not a seed phrase/);
  assert.match(card, /This file is the only copy/);
  assert.equal(recoveryAcknowledged(recoveryAckRecord()), true);
  assert.equal(recoveryAcknowledged(JSON.stringify({ downloaded: true, confirmed: true, words: PHRASE })), false);
  assert.deepEqual(recoveryResume(recoveryStepRecord('pass')), { step: 'pass', lost: false });
  assert.deepEqual(recoveryResume(recoveryStepRecord('confirm')), { step: 'pass', lost: true });
  assert.deepEqual(recoveryResume(JSON.stringify({ step: 'save', seed: PHRASE.join(' ') })), { step: 'tell', lost: true });
  assert.equal(recoveryStepRecord('save').includes('alpha'), false);
  assert.equal(parseImportKey('not-a-key'), null);
  assert.equal(parseImportKey(`${'1'.repeat(64)}`), '1'.repeat(64));
  assert.match(recoveryCard({ words: PHRASE, passphrase: 'correct horse' }), /Password:\ncorrect horse/);
});

/**
 * Achieves: verifies a recovery phrase is a real 12-word BIP39 mnemonic and the ack stores no words.
 * Fails when: a recovery phrase is a real 12-word BIP39 mnemonic and the ack stores no words breaks (e.g. expected [...Array(11, true, 12); failure/null paths flip.
 * Oracle: assert.equal(await verifyRecoveryPhrase(known), true); assert.equal(recoveryWords(known).length, 12); assert.equal(await verifyRecoveryPhrase(phrase), true); assert.equal([...storage.values()][0].includes('abandon'), false); assert.equal(readRecoveryAck(memory, 'did:privy:abc'); assert.deepEqual(known, [...Array(11)
 * Side effects / state checked: in-memory storage double writes/reads.
 * Gaps: none.
 */
test('a recovery phrase is a real 12-word BIP39 mnemonic and the ack stores no words', async () => {
  const known = await phraseFromEntropy(new Uint8Array(16));
  assert.deepEqual(known, [...Array(11).fill('abandon'), 'about']);
  assert.equal(await verifyRecoveryPhrase(known), true);
  assert.equal(recoveryWords(known).length, 12);
  const phrase = await createRecoveryPhrase(bytes => { bytes.fill(9); });
  assert.equal(await verifyRecoveryPhrase(phrase), true);
  const storage = new Map();
  const memory = {
    getItem: key => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, value),
  };
  writeRecoveryAck(memory, 'did:privy:abc');
  assert.equal([...storage.values()][0].includes('abandon'), false);
  assert.equal(readRecoveryAck(memory, 'did:privy:abc'), true);
});

/**
 * Achieves: verifies swap quotes skip restricted tokens and signup claims a handle before recovery.
 * Fails when: swap quotes skip restricted tokens and signup claims a handle before recovery breaks (e.g. expected rows, { inputSymbol: 'USDC', outputSymbol: 'SOL', amount: '1, false, /^https:\/\/quote-api\.dflow\.net\/quote\?/).
 * Oracle: assert.equal(swapQuoteUrl('jupiter', rows, { inputSymbol: 'USDC', outputSymbol: 'SOL', amount: '1000000', }); assert.equal(open.broadcast, false); assert.equal(draft.broadcast, false); assert.equal(swapDraft(deskTokens({}), { from: 'USDC', to: 'USDC', amountText: '1' }); assert.equal(swapDraft(deskTokens({}), { from: 'USDC', to: 'SOL', amountText: '0' }); assert.equal(settled.asset, 'USDC')
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('swap quotes skip restricted tokens and signup claims a handle before recovery', () => {
  const rows = deskTokens({ prefs: { restricted: ['SOL'] } });
  assert.equal(swapQuoteUrl('jupiter', rows, {
    inputSymbol: 'USDC',
    outputSymbol: 'SOL',
    amount: '1000000',
  }).error, 'not_tradeable');
  const open = swapQuoteUrl('dflow', deskTokens({}), {
    inputSymbol: 'USDC',
    outputSymbol: 'SOL',
    amount: '1000000',
  });
  assert.equal(open.broadcast, false);
  assert.match(open.url, /^https:\/\/quote-api\.dflow\.net\/quote\?/);
  const draft = swapDraft(deskTokens({}), { from: 'USDC', to: 'SOL', amountText: '1' });
  assert.equal(draft.broadcast, false);
  assert.match(draft.url, /^https:\/\/lite-api\.jup\.ag\/swap\/v1\/quote\?/);
  assert.equal(swapDraft(deskTokens({}), { from: 'USDC', to: 'USDC', amountText: '1' }).error, 'invalid_quote');
  assert.equal(swapDraft(deskTokens({}), { from: 'USDC', to: 'SOL', amountText: '0' }).error, 'invalid_amount');
  const priced = swapDraft(deskTokens({}), { from: 'SOL', to: 'USDC', amountText: '1' });
  const settled = swapSendSettlement({ inputSymbol: 'SOL', quoteOut: '1000000', quote: priced });
  assert.equal(settled.asset, 'USDC');
  assert.equal(settled.amount, '1000000');
  assert.equal(settled.broadcast, false);
  assert.equal(settled.authorizesTransaction, false);
  assert.equal(settled.label, 'devnet execution, mainnet pricing');
  assert.equal(swapSendSettlement({ inputSymbol: 'SOL', quoteOut: '1000000', quote: { ...priced, broadcast: true } }).error, 'quote_not_authorization');
  assert.equal(swapSendSettlement({ inputSymbol: 'USDC', quoteOut: '1000000', quote: priced }).error, 'invalid_quote');
  const base = {
    signedIn: true,
    profileReady: true,
    walletsReady: true,
    walletCount: 1,
    recoveryConfirmed: false,
  };
  assert.equal(accountSetupStep({ ...base, handle: '' }), 'handle');
  assert.equal(accountSetupStep({ ...base, handle: 'alex', walletsReady: false }), 'loading');
  assert.equal(accountSetupStep({ ...base, handle: 'alex', walletCount: 0 }), 'acceptance');
  assert.equal(accountSetupStep({ ...base, handle: 'alex', walletCount: 0, acceptanceConfirmed: true }), 'recovery');
  assert.equal(accountSetupStep({ ...base, handle: 'alex', walletCount: 0, acceptanceConfirmed: true, recoveryConfirmed: true }), null);
  assert.equal(accountSetupStep({ ...base, handle: 'alex' }), 'acceptance');
  assert.equal(accountSetupStep({ ...base, handle: 'alex', acceptanceConfirmed: true }), 'recovery');
  assert.equal(accountSetupStep({ ...base, handle: 'alex', acceptanceConfirmed: true, recoveryConfirmed: true }), null);
  assert.equal(SETUP_CARD_MS, 4000);
  assert.equal(setupCardVisible('loading'), null);
  assert.equal(setupCardVisible('handle'), 'handle');
  assert.equal(setupCardVisible(null), null);
});
