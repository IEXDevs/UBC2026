import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair, PublicKey, SystemInstruction, Transaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { SOLANA_CLUSTER } from '@ubc2026/contracts/solana';
import { sendWalletAsset } from './wallet-asset-send.mjs';
import { walletSendAssets, NATIVE_SOL_MINT } from './wallet-send-assets.mjs';
import { buildPortfolio } from './portfolio.mjs';
import { displayToUnits } from './wallet-desk.mjs';
import { portfolioWithDex } from './dex-token.mjs';

const source = Keypair.generate();
const destination = Keypair.generate().publicKey.toBase58();
const mint = Keypair.generate().publicKey.toBase58();
const blockhash = Keypair.generate().publicKey.toBase58();
const from = { id: 'main1234567890', privyWalletId: 'main1234567890', ownerId: 'did:privy:alice', kind: 'main', provider: 'privy', label: 'Main', address: source.publicKey.toBase58(), spendable: true, frozen: false };
const base = { ownerId: from.ownerId, from, wallets: [from], destination, asset: mint, amount: '123456789', decimals: 8, phase: 'send' };

function harness({ program = TOKEN_PROGRAM_ID, failSimulation = false } = {}) {
  const calls = [];
  return { calls, client: {
    async readSolanaAsset({ asset }) {
      calls.push('balance');
      return asset === 'SOL' ? { asset, decimals: 9, amount: '9000000000' } : {
        asset, decimals: 8, tokenProgramId: program.toBase58(), amount: '1234567890',
        accounts: [{ address: Keypair.generate().publicKey.toBase58(), amount: '100000000' }, { address: Keypair.generate().publicKey.toBase58(), amount: '1134567890' }],
      };
    },
    async getSolanaBlockhash() { return { cluster: SOLANA_CLUSTER, blockhash }; },
    async prepareSolanaTransfer({ transaction }) {
      calls.push({ transaction });
      if (failSimulation) throw Object.assign(new Error('simulation'), { code: 'simulation_failed' });
      return { transaction, feeLamports: '5000' };
    },
    async signPreparedOwnerSolana({ wallet }) {
      calls.push({ signer: wallet.id });
      return { cluster: SOLANA_CLUSTER, signature: 'offline-signature' };
    },
    async broadcastSignedSolana() { calls.push('broadcast'); return { cluster: SOLANA_CLUSTER, signature: 'offline-signature' }; },
  } };
}

for (const program of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
  test(`held token send creates recipient account and transfers exact base units with ${program}`, async () => {
    const { calls, client } = harness({ program });
    const result = await sendWalletAsset({ ...base, client });
    assert.equal(result.asset, mint);
    assert.equal(result.amount, '123456789');
    const transaction = Transaction.from(Buffer.from(calls.find(row => row.transaction).transaction, 'base64'));
    assert.deepEqual(transaction.signatures.map(row => row.publicKey.toBase58()), [from.address]);
    assert.equal(transaction.instructions.length, 4, 'create ATA, two source transfers, memo');
    const target = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(destination), false, program).toBase58();
    const moved = transaction.instructions.slice(1, 3);
    assert.deepEqual(moved.map(ix => ix.programId.toBase58()), [program.toBase58(), program.toBase58()]);
    assert.deepEqual(moved.map(ix => ix.data.readBigUInt64LE(1)), [100000000n, 23456789n]);
    assert.ok(moved.every(ix => ix.keys[2].pubkey.toBase58() === target && ix.data[9] === 8));
    assert.deepEqual(calls.at(-1), { signer: from.id });
  });
}

test('native SOL sends lamports, not wrapped SOL tokens or a USDC conversion', async () => {
  const { calls, client } = harness();
  await sendWalletAsset({ ...base, client, asset: 'SOL', amount: '123456789', decimals: 9 });
  const transaction = Transaction.from(Buffer.from(calls.find(row => row.transaction).transaction, 'base64'));
  const transfer = SystemInstruction.decodeTransfer(transaction.instructions[0]);
  assert.equal(transfer.lamports, 123456789n);
  assert.equal(transfer.toPubkey.toBase58(), destination);
  assert.equal(transaction.instructions.length, 2);
});

test('invalid amounts, insufficient balances, changed decimals and frozen sources never sign', async () => {
  for (const extra of [{ amount: '0' }, { amount: '18446744073709551616' }, { amount: '1234567891' }, { decimals: 9 }, { from: { ...from, frozen: true } }, { from: { ...from, ownerId: 'other' } }, { destination: from.address }, { destination: 'bad' }]) {
    const { client, calls } = harness();
    await assert.rejects(sendWalletAsset({ ...base, ...extra, client }));
    assert.equal(calls.some(row => row.signer), false);
  }
  const { client, calls } = harness({ failSimulation: true });
  await assert.rejects(sendWalletAsset({ ...base, client }), { code: 'simulation_failed' });
  assert.equal(calls.some(row => row.signer), false);
});

test('connected source requires a signature for the exact reconstructed asset transfer into Main', async () => {
  const connected = { ...from, id: 'linked_phantom', kind: 'additional', spendable: false };
  const main = { ...from, address: destination };
  const { client, calls } = harness();
  const args = { ...base, client, from: connected, wallets: [connected, main], asset: 'SOL', decimals: 9, phase: 'prepare' };
  const prepared = await sendWalletAsset(args);
  assert.equal(calls.some(row => row.signer || row === 'broadcast'), false);
  const transaction = Transaction.from(Buffer.from(prepared.transaction, 'base64'));
  transaction.sign(source);
  const signedTransaction = transaction.serialize().toString('base64');
  const sent = await sendWalletAsset({ ...args, phase: 'broadcast', signedTransaction });
  assert.equal(sent.signature, 'offline-signature');
  assert.equal(calls.filter(row => row === 'broadcast').length, 1);
  await assert.rejects(sendWalletAsset({ ...args, phase: 'broadcast', signedTransaction, amount: '1' }), { code: 'transaction_mismatch' });
  await assert.rejects(sendWalletAsset({ ...args, destination: Keypair.generate().publicKey.toBase58() }), { code: 'invalid_destination' });
  await assert.rejects(sendWalletAsset({ ...args, phase: 'send' }), { code: 'invalid_phase' });
  assert.equal(calls.filter(row => row === 'broadcast').length, 1);
});

test('Send assets come only from the selected wallet, including unpriced tokens, with native SOL separate from wSOL', () => {
  const portfolio = buildPortfolio({ cluster: SOLANA_CLUSTER === 'mainnet-beta' ? 'mainnet' : SOLANA_CLUSTER, wallets: [{ address: from.address, tokens: [
    { mint: NATIVE_SOL_MINT, amount: '1000000000', decimals: 9, native: true },
    { mint: NATIVE_SOL_MINT, amount: '2000000000', decimals: 9, native: false },
    { mint, amount: '123456789', decimals: 8 },
  ] }, { address: destination, tokens: [{ mint, amount: '999', decimals: 8 }] }] });
  const assets = walletSendAssets(portfolio, from.address);
  assert.deepEqual(Object.fromEntries(assets.map(row => [row.id, row.amount])), { SOL: '1000000000', [NATIVE_SOL_MINT]: '2000000000', [mint]: '123456789' });
  assert.equal(assets.find(row => row.id === NATIVE_SOL_MINT).symbol, 'wSOL');
  const enriched = walletSendAssets(portfolioWithDex(portfolio, [{ mint: NATIVE_SOL_MINT, symbol: 'SOL', priceUsd: '200' }]), from.address);
  assert.equal(enriched.find(row => row.id === 'SOL').amount, '1000000000');
  assert.equal(enriched.find(row => row.id === NATIVE_SOL_MINT).amount, '2000000000');
  assert.equal(enriched.find(row => row.id === NATIVE_SOL_MINT).symbol, 'wSOL');
  assert.deepEqual(walletSendAssets(portfolio, 'not-this-wallet'), []);
  assert.equal(displayToUnits('0.000000000001', 12), '1');
  assert.equal(displayToUnits('0.000000001', 8), null);
});
