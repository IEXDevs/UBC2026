import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JUPITER_PLUGIN_SRC,
  SOL_MINT,
  jupiterSwapStatus,
  passthroughWallet,
  swapPair,
  swapReceipt,
} from './jupiter-plugin.mjs';

const ADDRESS = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SIG = '5'.repeat(88);

class FakeTx {
  constructor(bytes) { this.bytes = bytes; }
  serialize() { return this.bytes; }
  static deserialize(bytes) { return new FakeTx(bytes); }
}

test('swap status gates on mainnet, wallet, freeze, and a browser signer', () => {
  assert.equal(jupiterSwapStatus({ cluster: 'devnet', address: ADDRESS, canSign: true }), 'not_mainnet');
  assert.equal(jupiterSwapStatus({ cluster: 'mainnet-beta', address: '', canSign: true }), 'no_wallet');
  assert.equal(jupiterSwapStatus({ cluster: 'mainnet-beta', address: ADDRESS, frozen: true, canSign: true }), 'frozen');
  assert.equal(jupiterSwapStatus({ cluster: 'mainnet-beta', address: ADDRESS }), 'no_signer');
  assert.equal(jupiterSwapStatus({ cluster: 'mainnet-beta', address: ADDRESS, canSign: true }), 'ready');
});

test('plugin script is the official Jupiter host', () => {
  assert.equal(new URL(JUPITER_PLUGIN_SRC).origin, 'https://plugin.jup.ag');
});

test('passthrough without a signer stays disconnected', () => {
  const context = passthroughWallet({ address: ADDRESS });
  assert.equal(context.connected, false);
  assert.equal(context.wallet, null);
  assert.equal(context.signTransaction, undefined);
});

test('passthrough signs the exact transaction bytes with the selected wallet', async () => {
  const unsigned = new Uint8Array(120).fill(1);
  const signedBytes = new Uint8Array(120).fill(2);
  const seen = [];
  const context = passthroughWallet({
    address: ADDRESS,
    name: 'Main',
    signBytes: async (bytes) => { seen.push(bytes); return signedBytes; },
  });
  assert.equal(context.connected, true);
  assert.equal(context.wallet.adapter.publicKey.toBase58(), ADDRESS);
  assert.equal(context.wallet.adapter.publicKey.toString(), ADDRESS);
  assert.equal(context.wallet.adapter.name, 'Main');
  const signed = await context.signTransaction(new FakeTx(unsigned));
  assert.deepEqual(seen, [unsigned]);
  assert.ok(signed instanceof FakeTx);
  assert.deepEqual(signed.serialize(), signedBytes);
});

test('a declined or empty signature surfaces as a cancelled wallet signing', async () => {
  const declined = passthroughWallet({ address: ADDRESS, signBytes: async () => { throw new Error('user rejected'); } });
  await assert.rejects(declined.signTransaction(new FakeTx(new Uint8Array(120))), { name: 'WalletSignTransactionError' });
  const empty = passthroughWallet({ address: ADDRESS, signBytes: async () => new Uint8Array(10) });
  await assert.rejects(empty.signTransaction(new FakeTx(new Uint8Array(120))), { name: 'WalletSignTransactionError' });
});

test('swap pair starts from the picked token and never pairs a token with itself', () => {
  assert.deepEqual(swapPair('', USDC), { initialInputMint: USDC, initialOutputMint: SOL_MINT });
  assert.deepEqual(swapPair(SOL_MINT, USDC), { initialInputMint: SOL_MINT, initialOutputMint: USDC });
  assert.deepEqual(swapPair('not a mint', USDC), { initialInputMint: USDC, initialOutputMint: SOL_MINT });
});

test('swap receipt needs a real signature', () => {
  assert.equal(swapReceipt({ signature: 'nope' }), null);
  const receipt = swapReceipt({ signature: SIG, walletLabel: 'Main', at: '2026-11-20T00:00:00.000Z' });
  assert.equal(receipt.id, `swap_${SIG}`);
  assert.equal(receipt.signature, SIG);
  assert.equal(receipt.lines[0].value, 'Main');
});
