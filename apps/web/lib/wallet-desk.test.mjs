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

test('send targets accept a handle, an SNS name, or an address', () => {
  assert.deepEqual(parseSendTarget('@Alex'), { kind: 'handle', handle: 'alex' });
  assert.deepEqual(parseSendTarget('richclub.sol'), { kind: 'sns', domain: 'richclub.sol' });
  assert.deepEqual(parseSendTarget(ADDRESS), { kind: 'address', address: ADDRESS });
  assert.equal(parseSendTarget('hello there'), null);
});

test('display amounts become base units', () => {
  assert.equal(displayToUnits('1.5', 6), '1500000');
  assert.equal(displayToUnits('0.000000001', 9), '1');
  assert.equal(displayToUnits('0', 6), null);
  assert.equal(displayToUnits('1.1234567', 6), null);
});

test('a price series becomes one line and a filled area', () => {
  const line = chartLine([2, 1, 3], 100, 40);
  assert.equal(line.up, true);
  assert.match(line.d, /^M/);
  assert.match(line.area, /Z$/);
  assert.equal(chartLine([1]), null);
});

test('quotes stay on the public Jupiter or DFlow read endpoints', () => {
  const jupiter = quoteUrl('jupiter', { inputMint: USDC_MINT, outputMint: SOL_MINT, amount: '1000000' });
  const dflow = quoteUrl('dflow', { inputMint: USDC_MINT, outputMint: SOL_MINT, amount: '1000000' });
  assert.match(jupiter, /^https:\/\/lite-api\.jup\.ag\/swap\/v1\/quote\?/);
  assert.match(dflow, /^https:\/\/quote-api\.dflow\.net\/quote\?/);
  assert.equal(quoteUrl('jupiter', { inputMint: USDC_MINT, outputMint: USDC_MINT, amount: '1' }), null);
  assert.equal(readQuoteOut({ outAmount: '42' }), '42');
  assert.equal(readQuoteOut({ outAmount: '1.2' }), null);
});

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
  assert.match(plain, /not a seed phrase/);
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
  assert.equal(accountSetupStep({ ...base, handle: 'alex', walletCount: 0 }), null);
  assert.equal(accountSetupStep({ ...base, handle: 'alex' }), 'recovery');
  assert.equal(accountSetupStep({ ...base, handle: 'alex', recoveryConfirmed: true }), null);
  assert.equal(SETUP_CARD_MS, 4000);
  assert.equal(setupCardVisible('loading'), null);
  assert.equal(setupCardVisible('handle'), 'handle');
  assert.equal(setupCardVisible(null), null);
});
