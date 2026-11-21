import assert from 'node:assert/strict';
import test from 'node:test';
import { SOLANA_PRIVY_CHAIN } from '@ubc2026/contracts/solana';
import { Keypair, Transaction, SystemProgram } from '@solana/web3.js';
import { browserCanSign, createOwnerAuthorizationSigner, browserSignerHasWallet, waitForBrowserSigner, withLinkedSolanaWallets, serverSignsWallet, signSelectedWalletTransaction, signWalletMoveTransaction } from './wallet-signing.mjs';

test('owner authorization signs absent agent wallets, preserves failures, and does not replace Main', async () => {
  const agent = { id: 'agent-wallet-id', address: 'agent', kind: 'additional', provider: 'privy' };
  const signed = new Uint8Array(100);
  const signer = { signWithOwnerAuthorization: async () => signed };
  assert.equal(browserCanSign(signer, agent), true);
  assert.equal(browserCanSign(signer, { ...agent, kind: 'main' }), false);
  assert.equal(browserCanSign(signer, { ...agent, id: 'linked_agent' }), false);
  assert.equal(await signSelectedWalletTransaction({ from: agent, transaction, signer }), signed);
  await assert.rejects(signSelectedWalletTransaction({ from: agent, transaction, signer, requireWalletApproval: true }),
    { code: 'wallet_connection_required' });
  await assert.rejects(signSelectedWalletTransaction({ from: { ...agent, kind: 'main' }, transaction, signer }), { code: 'wallet_connection_required' });
  await assert.rejects(signSelectedWalletTransaction({ from: agent, transaction, signer: {
    signWithOwnerAuthorization: async () => { throw { privyFailure: { status: 401 } }; },
  } }), error => error.code === 'wallet_owner_authorization_failed' && error.privyFailure.status === 401);
});

test('owner authorization helper sends exact bytes through request, approval, and sign', async () => {
  const calls = [];
  const sign = createOwnerAuthorizationSigner({ headers: async () => ({ authorization: 'Bearer mock' }),
    authorize: async bytes => { assert.deepEqual([...bytes], [1, 2, 3]); return { signature: 'approval' }; },
    fetchImpl: async (url, init) => {
      assert.equal(url, '/api/wallets/authorize-sign');
      calls.push(JSON.parse(init.body));
      return Response.json(calls.length === 1 ? { payload: 'AQID', expiresAt: 123 } : { signedTransaction: Buffer.from(transaction).toString('base64') });
    } });
  assert.deepEqual(await sign({ address: 'agent', transaction }), transaction);
  assert.deepEqual(calls.map(call => call.phase), ['request', 'sign']);
  assert.equal(calls[1].signature, 'approval');
  assert.equal(calls[1].expiresAt, 123);
  const rejected = createOwnerAuthorizationSigner({ fetchImpl: async () => Response.json({ error: 'wallet_frozen', privy: { status: 401 } }, { status: 400 }) });
  await assert.rejects(rejected({ address: 'agent', transaction }), error => error.code === 'wallet_frozen' && error.privyFailure.status === 401);
  const empty = createOwnerAuthorizationSigner({ authorize: async () => ({ signature: 'ok' }), fetchImpl: async () => Response.json({ payload: '', signedTransaction: '' }) });
  await assert.rejects(empty({ address: 'agent', transaction }), { code: 'invalid_signature' });
});

const transaction = new Uint8Array(100);
const from = { address: 'selected-external-account', label: 'Phantom', spendable: false };

test('browser signer polling re-reads readiness and supports a final case-insensitive lookup', async () => {
  const ready = { ready: true, wallets: [{ address: from.address }], signTransaction() {} };
  let reads = 0;
  assert.equal(await waitForBrowserSigner(() => ++reads === 1 ? { ready: false, wallets: [] } : ready, [from], 0), ready);
  assert.equal(browserSignerHasWallet(ready, from), true);
  assert.equal(browserSignerHasWallet({ ...ready, ready: false }, from), false);
  const differentCase = { ...ready, wallets: [{ address: from.address.toUpperCase() }] };
  assert.equal(browserSignerHasWallet(await waitForBrowserSigner(() => differentCase, [from], 0), from), true);
  assert.equal(browserSignerHasWallet({ ...ready, wallets: [] }, from), false);
});

test('linked Solana accounts use the Privy standard-wallet signing feature when absent from useWallets', async () => {
  const signedTransaction = new Uint8Array(120);
  let input;
  const standard = { features: { 'privy:': { privy: { async signTransaction(args) {
    input = args;
    return { signedTransaction };
  } } } } };
  const account = { type: 'wallet', chainType: 'solana', walletClientType: 'privy', address: from.address };
  const wallets = withLinkedSolanaWallets([], [standard], { linkedAccounts: [account] });
  assert.equal(await signSelectedWalletTransaction({ from, transaction, signer: { wallets,
    signTransaction: args => args.wallet.signTransaction(args) } }), signedTransaction);
  assert.deepEqual(input, { transaction, address: from.address, chain: SOLANA_PRIVY_CHAIN, options: undefined });
  assert.deepEqual(withLinkedSolanaWallets([], [], { linkedAccounts: [account] }), []);
  assert.deepEqual(withLinkedSolanaWallets([], [standard], { linkedAccounts: [{ ...account, userCanSign: false }] }), []);
});

test('browser move retains both signatures even when the second signer clears the first', async () => {
  const source = Keypair.generate();
  const payer = Keypair.generate();
  const wallets = [source, payer].map(key => ({ address: key.publicKey.toBase58() }));
  const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58() })
    .add(SystemProgram.transfer({ fromPubkey: source.publicKey, toPubkey: payer.publicKey, lamports: 1 }));
  const transaction = new Uint8Array(tx.serialize({ requireAllSignatures: false }));
  const signer = { wallets, async signTransaction({ transaction, wallet }) {
    const signed = Transaction.from(transaction);
    signed.signatures.forEach(entry => { entry.signature = null; });
    signed.partialSign(wallet.address === wallets[0].address ? source : payer);
    return { signedTransaction: new Uint8Array(signed.serialize({ requireAllSignatures: false })) };
  } };
  const signed = await signWalletMoveTransaction({ wallets, transaction, signer });
  assert.equal(Transaction.from(signed).verifySignatures(), true);
  await assert.rejects(signWalletMoveTransaction({ wallets: [], transaction, signer }), { code: 'invalid_signature' });
  signer.signTransaction = async ({ transaction }) => ({ signedTransaction: transaction });
  await assert.rejects(signWalletMoveTransaction({ wallets, transaction, signer }), { code: 'invalid_signature' });
});

test('browser move signs the agent before Main even when Main is listed first and the agent is in useWallets', async () => {
  const agent = Keypair.generate();
  const main = Keypair.generate();
  const wallets = [{ id: 'agent-wallet-id', kind: 'additional', provider: 'privy', address: agent.publicKey.toBase58() },
    { kind: 'main', address: main.publicKey.toBase58() }];
  const tx = new Transaction({ feePayer: main.publicKey, recentBlockhash: SystemProgram.programId.toBase58() })
    .add(SystemProgram.transfer({ fromPubkey: agent.publicKey, toPubkey: main.publicKey, lamports: 1 }));
  const sign = (transaction, key) => {
    const next = Transaction.from(transaction);
    next.signatures.forEach(entry => { entry.signature = null; });
    next.partialSign(key);
    return new Uint8Array(next.serialize({ requireAllSignatures: false }));
  };
  const calls = [];
  const signer = { ready: true, wallets,
    signWithOwnerAuthorization: async ({ transaction }) => { calls.push('agent'); return sign(transaction, agent); },
    signTransaction: async ({ transaction, wallet }) => {
      calls.push('main');
      assert.equal(wallet.address, main.publicKey.toBase58());
      const partial = Transaction.from(transaction);
      assert.ok(partial.signatures.find(entry => entry.publicKey.equals(agent.publicKey)).signature);
      assert.equal(partial.verifySignatures(false), true);
      return { signedTransaction: sign(transaction, main) };
    } };
  assert.equal(await waitForBrowserSigner(() => signer, wallets, 0), signer);
  const signed = await signWalletMoveTransaction({ wallets: [...wallets].reverse(), transaction: new Uint8Array(tx.serialize({ requireAllSignatures: false })), signer });
  assert.equal(Transaction.from(signed).verifySignatures(), true);
  assert.deepEqual(calls, ['agent', 'main']);
});

test('Privy wallets sign on the server and linked wallets stay in the browser', () => {
  assert.equal(serverSignsWallet({ id: 'cm5sender1234567890abcd', spendable: true, frozen: false }), true);
  assert.equal(serverSignsWallet({ id: 'cm5sender1234567890abcd', spendable: false, frozen: false, walletClientType: 'privy-v2' }), true);
  assert.equal(serverSignsWallet({ id: 'linked_So11111111111111111111111111111111111111112', spendable: false }), false);
  assert.equal(serverSignsWallet({ id: 'client_EPjFWdd5', spendable: true }), false);
  assert.equal(serverSignsWallet({ id: 'cm5sender1234567890abcd', frozen: true, spendable: true }), false);
});

test('signing routes to the selected external account rather than the default wallet', async () => {
  const main = { address: 'main-wallet' };
  const selected = { address: from.address };
  const signedTransaction = new Uint8Array(120);
  const calls = [];
  const signer = {
    wallets: [main, selected],
    async signTransaction(input) { calls.push(input); return { signedTransaction }; },
    connectWallet() { assert.fail('the selected wallet is already connected'); },
  };
  assert.equal(await signSelectedWalletTransaction({ from, transaction, signer }), signedTransaction);
  assert.deepEqual(calls, [{ transaction, wallet: selected, chain: SOLANA_PRIVY_CHAIN }]);
});

test('a disconnected or different account opens a Solana connection prompt without signing', async () => {
  const prompts = [];
  const signer = {
    wallets: [{ address: 'other-account-in-the-same-provider' }],
    connectWallet(options) { prompts.push(options); },
    signTransaction() { assert.fail('never fall back to another account'); },
  };
  await assert.rejects(signSelectedWalletTransaction({ from, transaction, signer }), { code: 'wallet_connection_required' });
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].walletChainType, 'solana-only');
  assert.match(prompts[0].description, /Phantom/);
});

test('rejection, missing signatures and frozen wallets fail without retrying another signer', async () => {
  const signer = {
    wallets: [{ address: from.address }],
    async signTransaction() { throw new Error('User rejected'); },
    connectWallet() { assert.fail('do not reopen after rejection'); },
  };
  await assert.rejects(signSelectedWalletTransaction({ from, transaction, signer }), { code: 'wallet_approval_cancelled' });
  signer.signTransaction = async () => ({});
  await assert.rejects(signSelectedWalletTransaction({ from, transaction, signer }), { code: 'invalid_signature' });
  signer.signTransaction = () => assert.fail('frozen wallets cannot sign');
  await assert.rejects(signSelectedWalletTransaction({ from: { ...from, frozen: true }, transaction, signer }), { code: 'wallet_frozen' });
});
