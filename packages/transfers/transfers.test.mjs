import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, Transaction, TransactionMessage, VersionedTransaction, ComputeBudgetInstruction } from '@solana/web3.js';
import { decodeTransferCheckedInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { assignBotWallet, createAdditionalWallet, createMainWallet } from '@ubc2026/wallets';
import {
  SOLANA_GENESIS_HASH,
  WalletError,
  createPrivyWalletClient,
} from '@ubc2026/wallets/privy';
import { SOLANA_USDC_MINT } from '@ubc2026/x402';
import {
  ASSOCIATED_TOKEN_PROGRAM,
  SOLANA_USDC_DECIMALS,
  MAINNET_USDC_MINT,
  MEMO_PROGRAM_ID,
  SPL_TOKEN_PROGRAM_ID,
  TransferError,
  buildSolanaUsdcTransaction,
  buildSolanaX402Transaction,
  depositFromWalletAdapter,
  grabBackToMain,
  moveBetweenWallets,
  transferSolanaUsdc,
  withdrawToWalletAdapter,
} from './transfers.mjs';

test('x402 builds only bounded compute budget and exact USDC transfer with the sponsor fee payer', () => {
  const owner = Keypair.generate().publicKey;
  const payer = Keypair.generate().publicKey;
  const payTo = Keypair.generate().publicKey;
  const accepted = { scheme: 'exact', network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    amount: '10000000', asset: SOLANA_USDC_MINT, payTo: payTo.toBase58(), extra: { feePayer: payer.toBase58() } };
  const args = { sourceOwner: owner.toBase58(), accepted, recentBlockhash: Keypair.generate().publicKey.toBase58() };
  const built = buildSolanaX402Transaction(args);
  const tx = VersionedTransaction.deserialize(Buffer.from(built.transaction, 'base64'));
  const message = TransactionMessage.decompile(tx.message);
  assert.equal(tx.version, 0);
  assert.equal(tx.message.header.numRequiredSignatures, 2);
  assert.equal(message.payerKey.toBase58(), payer.toBase58());
  assert.equal(message.instructions.length, 3);
  assert.equal(ComputeBudgetInstruction.decodeSetComputeUnitLimit(message.instructions[0]).units, 40000);
  assert.equal(ComputeBudgetInstruction.decodeSetComputeUnitPrice(message.instructions[1]).microLamports, 1n);
  const transfer = decodeTransferCheckedInstruction(message.instructions[2]);
  assert.equal(transfer.data.amount, 10000000n);
  assert.equal(transfer.data.decimals, 6);
  assert.equal(transfer.keys.owner.pubkey.toBase58(), owner.toBase58());
  assert.equal(transfer.keys.source.pubkey.toBase58(), getAssociatedTokenAddressSync(transfer.keys.mint.pubkey, owner).toBase58());
  assert.equal(transfer.keys.destination.pubkey.toBase58(), built.destinationTokenAccount);
  assert.equal(built.destinationTokenAccount, getAssociatedTokenAddressSync(transfer.keys.mint.pubkey, payTo).toBase58());
  for (const change of [{ asset: owner.toBase58() }, { network: 'solana:devnet' }, { scheme: 'other' }, { extra: { feePayer: owner.toBase58() } }]) {
    assert.throws(() => buildSolanaX402Transaction({ ...args, accepted: { ...accepted, ...change } }));
  }
  assert.throws(() => buildSolanaX402Transaction());
});

const appId = 'app_test';
const appSecret = 'app-secret-value';
const rpcUrl = 'https://example.invalid/quicknode-secret-path';
const walletId = 'fmfdj6yqly31huorjqzq38zc';
const tradingId = 'cm5addwallet1234567890abcd';
const vaultId = 'dm6addwallet1234567890abcd';
const txSignature = '5'.repeat(88);
const mainnetGenesis = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

const source = Keypair.generate();
const extra = Keypair.generate();
const vault = Keypair.generate();
const external = Keypair.generate();
const recipient = Keypair.generate();
const blockhash = Keypair.generate().publicKey.toBase58();

function walletRecord(ownerAddress, id, kind, label) {
  const base = kind === 'main'
    ? createMainWallet({ ownerId: 'user_1', address: ownerAddress, id })
    : createAdditionalWallet({ ownerId: 'user_1', address: ownerAddress, id, label });
  return { ...base, privyWalletId: id, privyUserId: 'did:privy:user1' };
}

const mainWallet = walletRecord(source.publicKey.toBase58(), walletId, 'main');
const tradingWallet = walletRecord(extra.publicKey.toBase58(), tradingId, 'additional', 'Trading');
const vaultWallet = walletRecord(vault.publicKey.toBase58(), vaultId, 'additional', 'Vault');

const bot = assignBotWallet({
  id: 'bot_1',
  ownerId: 'user_1',
  name: 'APY hunter',
  goal: 'Find yield',
  type: 'trading',
  approvalMode: 'ask',
  walletId: mainWallet.id,
  enabled: true,
  frozen: false,
  policyVersion: 1,
  cap: { mode: 'limited', asset: 'USDC', maxOutflow: '100000000', maxPerTransaction: '50000000' },
}, mainWallet);

function mockFetch(routes) {
  const calls = [];
  const fetcher = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, body });
    const match = routes.find(route => route.match(url, body, init));
    if (!match) return new Response(JSON.stringify({ error: 'unmocked' }), { status: 500 });
    return new Response(JSON.stringify(match.body), { status: match.status ?? 200 });
  };
  return { calls, fetcher };
}

function client(fetcher, routes) {
  const mocked = routes ? mockFetch(routes) : { fetcher, calls: [] };
  return {
    calls: mocked.calls,
    client: createPrivyWalletClient({
      appId,
      appSecret,
      rpcUrl,
      fetcher: mocked.fetcher,
      now: () => 1_700_000_000_000,
    }),
  };
}

function solanaRoutes({ sign = true } = {}) {
  const routes = [
    { match: (url, body) => url === rpcUrl && body?.method === 'getGenesisHash', body: { result: SOLANA_GENESIS_HASH } },
    { match: (url, body) => url === rpcUrl && body?.method === 'sendTransaction', body: { result: txSignature } },
  ];
  if (sign) {
    routes.unshift({
      match: (url, body) => String(url).endsWith('/rpc') && body?.method === 'signTransaction',
      body: { data: { signed_transaction: Buffer.alloc(180, 4).toString('base64') } },
    });
  }
  return routes;
}

function decode(base64) {
  return Transaction.from(Buffer.from(base64, 'base64'));
}

function assertMoveThenMemo(base64, { payer, amount, memo }) {
  const tx = decode(base64);
  assert.equal(tx.feePayer.toBase58(), payer);
  assert.equal(tx.recentBlockhash, blockhash);
  assert.equal(tx.signatures[0].signature, null);
  const [ata, transfer, note] = tx.instructions;
  assert.equal(ata.programId.toBase58(), ASSOCIATED_TOKEN_PROGRAM);
  assert.equal(ata.data[0], 1);
  assert.equal(transfer.programId.toBase58(), SPL_TOKEN_PROGRAM_ID);
  assert.equal(transfer.data[0], 12);
  assert.equal(transfer.data.readBigUInt64LE(1), BigInt(amount));
  assert.equal(transfer.data[9], SOLANA_USDC_DECIMALS);
  assert.equal(note.programId.toBase58(), MEMO_PROGRAM_ID);
  assert.equal(note.data.toString('utf8'), memo);
  assert.equal(tx.instructions.some(ix => ix.programId.toBase58() === MAINNET_USDC_MINT), false);
  const mintKey = transfer.keys[1].pubkey.toBase58();
  assert.equal(mintKey, SOLANA_USDC_MINT);
  assert.equal(mintKey, MAINNET_USDC_MINT);
  return tx;
}

/**
 * Achieves: transferSolanaUsdc signs via Privy then broadcasts a create-ATA + transferChecked + memo tx for SOLANA_USDC only.
 * Fails when: Mainnet mint appears, memo/order wrong, secrets leak, or sendTransaction skipped/duplicated wrongly.
 * Oracle: SPL Token transferChecked + memo program layout + SOLANA_USDC_MINT.
 * Side effects: Injected Privy/RPC mock fetch.
 * Gaps: Does not cover ATA already-exists races.
 */
test('a bot transfer is Privy-signed, then a mainnet-beta USDC move, then a memo', async () => {
  const memo = 'decision:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const { client: signer, calls } = client(null, solanaRoutes());
  const moved = await transferSolanaUsdc({
    client: signer,
    bot,
    wallet: mainWallet,
    destination: recipient.publicKey.toBase58(),
    amount: '2500000',
    memo,
    recentBlockhash: blockhash,
  });
  assert.equal(moved.kind, 'transfer');
  assert.equal(moved.cluster, 'mainnet-beta');
  assert.equal(moved.signature, txSignature);
  assert.equal(moved.mint, SOLANA_USDC_MINT);
  const sign = calls.find(call => call.body?.method === 'signTransaction');
  assertMoveThenMemo(sign.body.params.transaction, {
    payer: mainWallet.address,
    amount: '2500000',
    memo,
  });
  assert.equal(calls.filter(call => call.body?.method === 'sendTransaction').length, 1);
  assert.equal(calls.filter(call => call.body?.method === 'sendTransaction').every(call => call.url === rpcUrl), true);
  assert.equal(JSON.stringify(moved).includes(appSecret), false);
  assert.equal(JSON.stringify(moved).includes('quicknode-secret-path'), false);
  assert.equal(JSON.stringify(sign.body).includes(appSecret), false);
});

/**
 * Achieves: build/transfer refuse mainnet cluster, frozen wallets, and mainnet genesis before sendTransaction.
 * Fails when: Any of those paths still broadcasts.
 * Oracle: SOLANA_GENESIS_HASH gate + WalletError/TransferError codes.
 * Side effects: Injected mocks; asserts no sign/send side effects.
 * Gaps: Does not cover testnet genesis explicitly.
 */
test('mainnet cluster, mainnet genesis, and a frozen wallet never broadcast', async () => {
  const calls = [];
  const signer = {
    async signAndBroadcastSolana() {
      calls.push('sign');
      return { cluster: 'mainnet', signature: txSignature };
    },
    async getSolanaBlockhash() {
      calls.push('hash');
      return { cluster: 'mainnet-beta', blockhash };
    },
  };
  assert.throws(
    () => buildSolanaUsdcTransaction({
      feePayer: mainWallet.address,
      sourceOwner: mainWallet.address,
      destinationOwner: recipient.publicKey.toBase58(),
      amount: '1',
      memo: 'memo',
      recentBlockhash: blockhash,
      cluster: 'mainnet',
    }),
    error => error instanceof TransferError && error.code === 'wrong_cluster',
  );
  await assert.rejects(
    () => transferSolanaUsdc({
      client: signer,
      bot,
      wallet: { ...mainWallet, frozen: true },
      destination: recipient.publicKey.toBase58(),
      amount: '1',
      memo: 'memo',
      recentBlockhash: blockhash,
    }),
    error => error instanceof WalletError,
  );
  const { client: live, calls: rpc } = client(null, [
    { match: (url, body) => url === rpcUrl && body?.method === 'getGenesisHash', body: { result: mainnetGenesis } },
    {
      match: (url, body) => String(url).endsWith('/rpc') && body?.method === 'signTransaction',
      body: { data: { signed_transaction: Buffer.alloc(180, 4).toString('base64') } },
    },
  ]);
  await assert.rejects(
    () => transferSolanaUsdc({
      client: live,
      bot,
      wallet: mainWallet,
      destination: recipient.publicKey.toBase58(),
      amount: '1',
      memo: 'memo',
      recentBlockhash: blockhash,
    }),
    error => error instanceof WalletError && error.code === 'wrong_cluster',
  );
  assert.equal(rpc.some(call => call.body?.method === 'sendTransaction'), false);
  assert.deepEqual(calls, []);
});

/**
 * Achieves: External adapter signs locally; runtime broadcasts on verified solana; adapter never sendTransaction; mainnet genesis blocks before sign.
 * Fails when: Adapter broadcasts, Privy signs deposits, or mainnet still sends.
 * Oracle: Deposit path ownership: adapter signs, QuickNode broadcasts.
 * Side effects: Injected adapter + RPC mocks.
 * Gaps: Does not cover adapter disconnect mid-sign.
 */
test('wallet adapter deposit signs locally and broadcasts only on mainnet-beta', async () => {
  let signed = 0;
  let adapterSent = 0;
  const adapter = {
    publicKey: external.publicKey,
    sendTransaction() {
      adapterSent += 1;
      throw new Error('adapter must not broadcast');
    },
    async signTransaction(tx) {
      signed += 1;
      tx.partialSign(external);
      return tx;
    },
  };
  const { client: signer, calls } = client(null, solanaRoutes({ sign: false }));
  const deposited = await depositFromWalletAdapter({
    client: signer,
    adapter,
    mainWallet,
    ownerId: 'user_1',
    amount: '1000000',
    memo: 'deposit',
    recentBlockhash: blockhash,
  });
  assert.equal(deposited.kind, 'deposit');
  assert.equal(deposited.source, external.publicKey.toBase58());
  assert.equal(deposited.destination, mainWallet.address);
  assert.equal(deposited.signature, txSignature);
  assert.equal(signed, 1);
  assert.equal(adapterSent, 0);
  assert.equal(calls.some(call => String(call.url).includes('api.privy.io')), false);
  const sent = calls.find(call => call.body?.method === 'sendTransaction');
  const tx = decode(sent.body.params[0]);
  assert.equal(tx.instructions[1].data[0], 12);
  assert.equal(tx.instructions[2].data.toString('utf8'), 'deposit');
  assert.equal(tx.feePayer.toBase58(), external.publicKey.toBase58());

  signed = 0;
  const blocked = client(null, [
    { match: (url, body) => url === rpcUrl && body?.method === 'getGenesisHash', body: { result: mainnetGenesis } },
  ]);
  await assert.rejects(
    () => depositFromWalletAdapter({
      client: blocked.client,
      adapter,
      mainWallet,
      ownerId: 'user_1',
      amount: '1000000',
      memo: 'deposit',
      recentBlockhash: blockhash,
    }),
    error => error instanceof WalletError && error.code === 'wrong_cluster',
  );
  assert.equal(signed, 0);
  assert.equal(blocked.calls.some(call => call.body?.method === 'sendTransaction'), false);
});

/**
 * Achieves: Withdraw/move/grab-back are Privy-signed USDC moves with expected memos; frozen sleeves can still be grabbed.
 * Fails when: Wrong destinations/memos, adapter signs withdraws, or frozen wallets are skipped for grab-back.
 * Oracle: Owner wallet ops memos: withdraw / wallet.move / funds.grabbed.
 * Side effects: Injected Privy/RPC mocks.
 * Gaps: Does not cover zero-balance no-op grab across all sleeves in isolation.
 */
test('withdraw, wallet moves, and grab-back return USDC to the main wallet', async () => {
  let adapterSigned = 0;
  const adapter = {
    publicKey: external.publicKey,
    sendTransaction() { throw new Error('adapter must not broadcast'); },
    async signTransaction() { adapterSigned += 1; },
  };
  const { client: signer, calls } = client(null, solanaRoutes());
  const withdrawn = await withdrawToWalletAdapter({
    client: signer,
    ownerId: 'user_1',
    mainWallet,
    adapter,
    amount: '4000000',
    memo: 'withdraw',
    recentBlockhash: blockhash,
  });
  assert.equal(withdrawn.kind, 'withdraw');
  assert.equal(withdrawn.destination, external.publicKey.toBase58());
  assert.equal(adapterSigned, 0);

  const moved = await moveBetweenWallets({
    client: signer,
    ownerId: 'user_1',
    fromWallet: mainWallet,
    toWallet: tradingWallet,
    amount: '500000',
    recentBlockhash: blockhash,
  });
  assert.equal(moved.kind, 'move');
  assert.equal(moved.memo, 'wallet.move');
  assert.equal(moved.destination, tradingWallet.address);

  const frozenTrading = { ...tradingWallet, frozen: true };
  const grabbed = await grabBackToMain({
    client: signer,
    ownerId: 'user_1',
    mainWallet,
    wallets: [frozenTrading, vaultWallet],
    balances: { [tradingId]: '900000', [vaultId]: '0' },
    recentBlockhash: blockhash,
  });
  assert.equal(grabbed.moves.length, 1);
  assert.equal(grabbed.moves[0].kind, 'grab-back');
  assert.equal(grabbed.moves[0].amount, '900000');
  assert.equal(grabbed.moves[0].destination, mainWallet.address);
  assert.equal(grabbed.moves[0].memo, 'funds.grabbed');
  assert.equal(frozenTrading.frozen, true);

  const signCalls = calls.filter(call => call.body?.method === 'signTransaction');
  assert.equal(signCalls.length, 3);
  assertMoveThenMemo(signCalls[2].body.params.transaction, {
    payer: tradingWallet.address,
    amount: '900000',
    memo: 'funds.grabbed',
  });
  assert.equal(calls.filter(call => call.body?.method === 'sendTransaction').length, 3);
});

/**
 * Achieves: Missing balances are read via getTokenAccountsByOwner for SOLANA_USDC; partial grab failures retain completed moves.
 * Fails when: Mainnet mint queried, or earlier successes discarded on later failure.
 * Oracle: TransferError.completed partial-failure contract.
 * Side effects: Injected RPC mocks.
 * Gaps: Does not retry/resume remaining sleeves after failure.
 */
test('grab-back can read mainnet-beta balances and keeps earlier sweeps when a later one fails', async () => {
  const routes = solanaRoutes();
  routes.push({
    match: (url, body) => url === rpcUrl && body?.method === 'getTokenAccountsByOwner',
    body: {
      result: {
        value: [{
          account: {
            data: { parsed: { info: { mint: SOLANA_USDC_MINT, tokenAmount: { amount: '42', decimals: 6 } } } },
          },
        }],
      },
    },
  });
  const { client: signer, calls } = client(null, routes);
  const grabbed = await grabBackToMain({
    client: signer,
    ownerId: 'user_1',
    mainWallet,
    wallets: [tradingWallet],
    recentBlockhash: blockhash,
  });
  assert.equal(grabbed.moves[0].amount, '42');
  const balanceCall = calls.find(call => call.body?.method === 'getTokenAccountsByOwner');
  assert.deepEqual(balanceCall.body.params[1], { mint: SOLANA_USDC_MINT });
  assert.equal(SOLANA_USDC_MINT, MAINNET_USDC_MINT);

  let attempts = 0;
  const failing = {
    async signAndBroadcastOwnerSolana() {
      attempts += 1;
      if (attempts === 2) {
        const error = new WalletError('Solana broadcast did not return a signature', 'rpc_rejected');
        throw error;
      }
      return { cluster: 'mainnet-beta', signature: txSignature };
    },
  };
  await assert.rejects(
    () => grabBackToMain({
      client: failing,
      ownerId: 'user_1',
      mainWallet,
      wallets: [tradingWallet, vaultWallet],
      balances: { [tradingId]: '5', [vaultId]: '6' },
      recentBlockhash: blockhash,
    }),
    error => error instanceof TransferError && error.code === 'rpc_rejected' && error.completed.length === 1,
  );
});
