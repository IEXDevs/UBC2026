import { SOLANA_CLUSTER } from '@ubc2026/contracts/solana';
/**
 * Solana USDC movement for Maelstrom.
 * Privy signs bot transfers and owner moves, then the existing solana
 * broadcaster sends them. A Wallet Adapter signs deposits locally.
 * Every transaction is a USDC transfer followed by a memo.
 * This module never opens a Solana connection and never broadcasts.
 */
import { PublicKey, SystemProgram, Transaction, TransactionInstruction, ComputeBudgetProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { ContractError, validateWallet } from '@ubc2026/contracts';
import { assertSpendAllowed } from '@ubc2026/wallets';
import { SOLANA_USDC_MINT } from '@ubc2026/wallets/privy';
import { SOLANA_USDC_MINT as X402_SOLANA_USDC_MINT } from '@ubc2026/x402';

if (SOLANA_USDC_MINT !== X402_SOLANA_USDC_MINT) {
  throw new Error('Solana USDC mint does not match @ubc2026/x402');
}

export { SOLANA_USDC_MINT };
export { buildJupiterSwap } from './jupiter-swap.mjs';

export function buildSolanaX402Transaction({ sourceOwner, accepted, recentBlockhash } = {}) {
  if (SOLANA_CLUSTER !== 'mainnet-beta' || accepted?.scheme !== 'exact'
      || accepted.network !== 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
      || accepted.asset !== SOLANA_USDC_MINT || accepted.extra?.memo != null) fail('Unsupported x402 terms', 'invalid_payment');
  const source = pubkey(sourceOwner, 'source wallet');
  const payer = pubkey(accepted.extra?.feePayer, 'fee payer');
  const destination = pubkey(accepted.payTo, 'recipient');
  if (source.equals(payer) || source.equals(destination)) fail('Invalid x402 payer', 'invalid_payment');
  pubkey(recentBlockhash, 'blockhash');
  const sourceAccount = tokenAccount(source);
  const destinationAccount = tokenAccount(destination);
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash, instructions: [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 40_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
    createTransferCheckedInstruction(sourceAccount, pubkey(SOLANA_USDC_MINT, 'mint'), destinationAccount,
      source, positiveAmount(accepted.amount), 6, [], TOKEN_PROGRAM_ID),
  ] }).compileToV0Message();
  return {
    transaction: Buffer.from(new VersionedTransaction(message).serialize()).toString('base64'),
    sourceTokenAccount: sourceAccount.toBase58(),
    destinationTokenAccount: destinationAccount.toBase58(),
  };
}

export const SPL_TOKEN_PROGRAM_ID = TOKEN_PROGRAM_ID.toBase58();
export const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export const ASSOCIATED_TOKEN_PROGRAM = ASSOCIATED_TOKEN_PROGRAM_ID.toBase58();
export const SOLANA_USDC_DECIMALS = 6;
export const MAINNET_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const U64_MAX = 18446744073709551615n;
const MEMO_PROGRAM = new PublicKey(MEMO_PROGRAM_ID);
const base58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export class TransferError extends Error {
  constructor(message, code = 'transfer_error') {
    super(message);
    this.name = 'TransferError';
    this.code = code;
  }
}

const fail = (message, code) => { throw new TransferError(message, code); };

function amount(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,39})$/.test(value)) {
    fail('Amounts must be unsigned integer strings in base units', 'invalid_amount');
  }
  const parsed = BigInt(value);
  if (parsed > U64_MAX) fail('Amount exceeds u64', 'invalid_amount');
  return parsed;
}

function positiveAmount(value) {
  const parsed = amount(value);
  if (parsed === 0n) fail('Amount must be greater than zero', 'invalid_amount');
  return parsed;
}

function pubkey(value, label) {
  if (typeof value !== 'string' || !base58.test(value)) fail(`Invalid ${label}`, 'invalid_address');
  try {
    return new PublicKey(value);
  } catch {
    fail(`Invalid ${label}`, 'invalid_address');
  }
}

function memoBytes(memo) {
  if (typeof memo !== 'string') fail('Memo is required', 'invalid_memo');
  const bytes = Buffer.from(memo, 'utf8');
  if (bytes.length < 1 || bytes.length > 566) fail('Memo must be 1 to 566 bytes', 'invalid_memo');
  return bytes;
}

function ownedWallet(wallet, ownerId) {
  let record;
  try {
    record = validateWallet(wallet);
  } catch (error) {
    if (error instanceof ContractError) fail(error.message, 'invalid_wallet');
    throw error;
  }
  if (typeof ownerId !== 'string' || record.ownerId !== ownerId) fail('Wallet owner must match', 'owner_mismatch');
  return record;
}

function adapterAddress(adapter) {
  const key = adapter?.publicKey;
  const address = typeof key === 'string'
    ? key
    : key?.toBase58?.() ?? (typeof key?.toString === 'function' ? key.toString() : '');
  pubkey(address, 'wallet adapter address');
  return address;
}

function requireMethod(client, name) {
  if (!client || typeof client[name] !== 'function') fail(`Solana signing helper ${name} is required`, 'missing_signer');
}

async function blockhashFrom(client, recentBlockhash) {
  if (recentBlockhash != null && recentBlockhash !== '') {
    pubkey(recentBlockhash, 'blockhash');
    return recentBlockhash;
  }
  requireMethod(client, 'getSolanaBlockhash');
  const loaded = await client.getSolanaBlockhash();
  if (!loaded || loaded.cluster !== SOLANA_CLUSTER) fail('Refusing to build a transfer outside Solana mainnet-beta', 'wrong_cluster');
  pubkey(loaded.blockhash, 'blockhash');
  return loaded.blockhash;
}

function tokenAccount(owner) {
  return getAssociatedTokenAddressSync(
    pubkey(SOLANA_USDC_MINT, 'mint'),
    owner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}

/**
 * Unsigned legacy transaction: create the destination USDC account if needed,
 * transfer mainnet-beta USDC, then write the memo. Nothing is signed or sent.
 */
export function buildSolanaUsdcTransaction({
  feePayer,
  sourceOwner,
  destinationOwner,
  amount: rawAmount,
  memo,
  recentBlockhash,
  cluster = SOLANA_CLUSTER,
} = {}) {
  if (cluster !== SOLANA_CLUSTER) fail('Hackathon transfers must use Solana mainnet-beta', 'wrong_cluster');
  const units = positiveAmount(rawAmount);
  const memoData = memoBytes(memo);
  const payer = pubkey(feePayer, 'fee payer');
  const source = pubkey(sourceOwner, 'source wallet');
  const destination = pubkey(destinationOwner, 'destination wallet');
  pubkey(recentBlockhash, 'blockhash');
  if (source.equals(destination)) fail('Source and destination must differ', 'invalid_destination');

  const sourceTokenAccount = tokenAccount(source);
  const destinationTokenAccount = tokenAccount(destination);
  const mint = pubkey(SOLANA_USDC_MINT, 'mint');
  const transaction = new Transaction({ feePayer: payer, recentBlockhash });
  transaction.add(
    createAssociatedTokenAccountIdempotentInstruction(
      payer,
      destinationTokenAccount,
      destination,
      mint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
    createTransferCheckedInstruction(
      sourceTokenAccount,
      mint,
      destinationTokenAccount,
      source,
      units,
      SOLANA_USDC_DECIMALS,
      [],
      TOKEN_PROGRAM_ID,
    ),
    new TransactionInstruction({
      programId: MEMO_PROGRAM,
      keys: [{ pubkey: payer, isSigner: true, isWritable: false }],
      data: memoData,
    }),
  );
  const transactionBase64 = transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  }).toString('base64');
  return {
    cluster: SOLANA_CLUSTER,
    mint: SOLANA_USDC_MINT,
    amount: units.toString(),
    memo,
    feePayer,
    sourceOwner,
    destinationOwner,
    sourceTokenAccount: sourceTokenAccount.toBase58(),
    destinationTokenAccount: destinationTokenAccount.toBase58(),
    transaction,
    transactionBase64,
  };
}

/** Native SOL or a classic SPL token with an existing destination token account. */
export function buildSolanaAssetTransaction({ asset, decimals, sourceOwner, destinationOwner, amount: rawAmount, memo, recentBlockhash } = {}) {
  const units = positiveAmount(rawAmount);
  const source = pubkey(sourceOwner, 'source wallet');
  const destination = pubkey(destinationOwner, 'destination wallet');
  pubkey(recentBlockhash, 'blockhash');
  if (source.equals(destination)) fail('Source and destination must differ', 'invalid_destination');
  let instruction;
  if (asset === 'SOL') {
    instruction = SystemProgram.transfer({ fromPubkey: source, toPubkey: destination, lamports: units });
  } else {
    const mint = pubkey(asset, 'mint');
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) fail('Invalid mint decimals', 'invalid_mint');
    instruction = createTransferCheckedInstruction(
      getAssociatedTokenAddressSync(mint, source), mint, getAssociatedTokenAddressSync(mint, destination), source, units, decimals,
    );
  }
  const transaction = new Transaction({ feePayer: source, recentBlockhash }).add(instruction, new TransactionInstruction({
    programId: MEMO_PROGRAM,
    keys: [{ pubkey: source, isSigner: true, isWritable: false }],
    data: memoBytes(memo),
  }));
  return transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
}

/** Owner-confirmed send; token accounts and mint details come from chain reads. */
export function buildWalletAssetTransaction({ asset, decimals, tokenProgramId, accounts = [], sourceOwner, destinationOwner, amount: rawAmount, memo = 'wallet.send', recentBlockhash } = {}) {
  if (asset === 'SOL') return buildSolanaAssetTransaction({ asset, sourceOwner, destinationOwner, amount: rawAmount, memo, recentBlockhash });
  const amount = positiveAmount(rawAmount);
  const source = pubkey(sourceOwner, 'source wallet');
  const destination = pubkey(destinationOwner, 'destination wallet');
  const mint = pubkey(asset, 'mint');
  const program = pubkey(tokenProgramId, 'token program');
  if (!program.equals(TOKEN_PROGRAM_ID) && !program.equals(TOKEN_2022_PROGRAM_ID)) fail('Unsupported token program', 'unsupported_mint');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) fail('Invalid mint decimals', 'invalid_mint');
  if (source.equals(destination)) fail('Source and destination must differ', 'invalid_destination');
  pubkey(recentBlockhash, 'blockhash');
  const target = getAssociatedTokenAddressSync(mint, destination, false, program);
  const transaction = new Transaction({ feePayer: source, recentBlockhash }).add(
    createAssociatedTokenAccountIdempotentInstruction(source, target, destination, mint, program),
  );
  let remaining = amount;
  const seen = new Set();
  for (const account of accounts) {
    if (remaining === 0n) break;
    if (seen.has(account.address)) continue;
    seen.add(account.address);
    const available = positiveAmount(account.amount);
    const moved = available < remaining ? available : remaining;
    transaction.add(createTransferCheckedInstruction(pubkey(account.address, 'token account'), mint, target, source, moved, decimals, [], program));
    remaining -= moved;
  }
  if (remaining !== 0n) fail('Insufficient token balance', 'insufficient_balance');
  transaction.add(new TransactionInstruction({ programId: MEMO_PROGRAM, keys: [{ pubkey: source, isSigner: true, isWritable: false }], data: memoBytes(memo) }));
  return transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
}

function movementResult(kind, built, signature) {
  return {
    kind,
    cluster: SOLANA_CLUSTER,
    mint: built.mint,
    amount: built.amount,
    memo: built.memo,
    signature,
    source: built.sourceOwner,
    destination: built.destinationOwner,
    sourceTokenAccount: built.sourceTokenAccount,
    destinationTokenAccount: built.destinationTokenAccount,
  };
}

export async function transferSolanaUsdc({
  client,
  bot,
  wallet,
  destination,
  amount: rawAmount,
  memo,
  recentBlockhash,
} = {}) {
  requireMethod(client, 'signAndBroadcastSolana');
  assertSpendAllowed({ bot, wallet });
  if (wallet.address === destination) fail('Source and destination must differ', 'invalid_destination');
  const hash = await blockhashFrom(client, recentBlockhash);
  const built = buildSolanaUsdcTransaction({
    feePayer: wallet.address,
    sourceOwner: wallet.address,
    destinationOwner: destination,
    amount: rawAmount,
    memo,
    recentBlockhash: hash,
  });
  const sent = await client.signAndBroadcastSolana({
    bot,
    wallet,
    transaction: built.transactionBase64,
  });
  if (!sent || sent.cluster !== SOLANA_CLUSTER) fail('Refusing to broadcast outside Solana mainnet-beta', 'wrong_cluster');
  return movementResult('transfer', built, sent.signature);
}

async function ownerMove({
  client,
  ownerId,
  fromWallet,
  feePayerWallet,
  toAddress,
  amount: rawAmount,
  memo,
  recentBlockhash,
  kind,
  accessToken,
  phase = 'send',
  signedTransaction,
}) {
  if (!['send', 'prepare', 'broadcast'].includes(phase)) fail('Invalid move phase', 'invalid_phase');
  requireMethod(client, phase === 'send' ? 'signAndBroadcastOwnerSolana' : 'prepareSolanaTransfer');
  const source = ownedWallet(fromWallet, ownerId);
  const payer = feePayerWallet ? ownedWallet(feePayerWallet, ownerId) : source;
  if (phase !== 'send' && (source.frozen || payer.frozen || source.spendable === false || payer.spendable === false)) {
    fail('Wallet cannot sign', 'wallet_frozen');
  }
  if (source.address === toAddress) fail('Source and destination must differ', 'invalid_destination');
  let signed;
  if (phase === 'broadcast') {
    try {
      if (typeof signedTransaction !== 'string' || signedTransaction.length > 2000) fail('Invalid signature', 'invalid_signature');
      signed = Transaction.from(Buffer.from(signedTransaction, 'base64'));
      if (!signed.verifySignatures()) fail('Invalid signature', 'invalid_signature');
    } catch { fail('Invalid signature', 'invalid_signature'); }
  }
  const hash = signed ? signed.recentBlockhash : await blockhashFrom(client, recentBlockhash);
  const built = buildSolanaUsdcTransaction({
    feePayer: payer.address,
    sourceOwner: source.address,
    destinationOwner: toAddress,
    amount: rawAmount,
    memo,
    recentBlockhash: hash,
  });
  if (phase !== 'send') {
    if (signed && !signed.serializeMessage().equals(built.transaction.serializeMessage())) {
      fail('Signed transfer differs from request', 'transaction_mismatch');
    }
    const signerWallets = payer.address === source.address ? [source] : [source, payer];
    await client.prepareSolanaTransfer({ transaction: built.transactionBase64,
      requiredSignerAddresses: signerWallets.map(wallet => wallet.address) });
    if (phase === 'prepare') return { cluster: SOLANA_CLUSTER, transaction: built.transactionBase64, signerWallets };
    requireMethod(client, 'broadcastSignedSolana');
    const sent = await client.broadcastSignedSolana({ signedTransaction });
    if (sent?.cluster !== SOLANA_CLUSTER) fail('Wrong cluster', 'wrong_cluster');
    return movementResult(kind, built, sent.signature);
  }
  const sent = await client.signAndBroadcastOwnerSolana({
    ownerId,
    wallet: source,
    feePayerWallet,
    transaction: built.transactionBase64,
    accessToken,
  });
  if (!sent || sent.cluster !== SOLANA_CLUSTER) fail('Refusing to broadcast outside Solana mainnet-beta', 'wrong_cluster');
  return movementResult(kind, built, sent.signature);
}

export async function moveBetweenWallets({
  client,
  ownerId,
  fromWallet,
  feePayerWallet,
  toWallet,
  amount: rawAmount,
  memo = 'wallet.move',
  recentBlockhash,
  accessToken,
  phase = 'send',
  signedTransaction,
} = {}) {
  const destination = ownedWallet(toWallet, ownerId);
  if (phase !== 'send' && destination.frozen) fail('Wallet is frozen', 'wallet_frozen');
  if (fromWallet?.id === destination.id) fail('Source and destination must differ', 'invalid_destination');
  return ownerMove({
    client,
    ownerId,
    fromWallet,
    feePayerWallet,
    toAddress: destination.address,
    amount: rawAmount,
    memo,
    recentBlockhash,
    kind: 'move',
    accessToken,
    phase,
    signedTransaction,
  });
}

export async function withdrawToWalletAdapter({
  client,
  ownerId,
  mainWallet,
  adapter,
  amount: rawAmount,
  memo = 'withdraw',
  recentBlockhash,
} = {}) {
  const source = ownedWallet(mainWallet, ownerId);
  if (source.kind !== 'main') fail('Withdrawals come from the main wallet', 'invalid_wallet');
  // The adapter only names the destination wallet. It does not sign or broadcast.
  const external = adapterAddress(adapter);
  return ownerMove({
    client,
    ownerId,
    fromWallet: source,
    toAddress: external,
    amount: rawAmount,
    memo,
    recentBlockhash,
    kind: 'withdraw',
  });
}

export async function depositFromWalletAdapter({
  client,
  adapter,
  mainWallet,
  ownerId,
  amount: rawAmount,
  memo = 'deposit',
  recentBlockhash,
} = {}) {
  requireMethod(client, 'assertSolanaCluster');
  requireMethod(client, 'broadcastSignedSolana');
  const main = ownedWallet(mainWallet, ownerId);
  if (main.kind !== 'main') fail('Deposits go to the main wallet', 'invalid_wallet');
  if (!adapter || typeof adapter.signTransaction !== 'function') {
    fail('Wallet adapter signTransaction is required', 'missing_signer');
  }
  const external = adapterAddress(adapter);
  const hash = await blockhashFrom(client, recentBlockhash);
  const built = buildSolanaUsdcTransaction({
    feePayer: external,
    sourceOwner: external,
    destinationOwner: main.address,
    amount: rawAmount,
    memo,
    recentBlockhash: hash,
  });
  await client.assertSolanaCluster();
  let signed;
  try {
    signed = await adapter.signTransaction(built.transaction);
  } catch (error) {
    if (error instanceof TransferError) throw error;
    fail('Wallet adapter did not sign the deposit', 'invalid_signature');
  }
  if (!signed || typeof signed.serialize !== 'function') fail('Wallet adapter did not sign the deposit', 'invalid_signature');
  let transactionBase64;
  try {
    transactionBase64 = signed.serialize({ requireAllSignatures: true, verifySignatures: true }).toString('base64');
  } catch {
    fail('Wallet adapter did not sign the deposit', 'invalid_signature');
  }
  const sent = await client.broadcastSignedSolana({ signedTransaction: transactionBase64 });
  if (!sent || sent.cluster !== SOLANA_CLUSTER) fail('Refusing to broadcast outside Solana mainnet-beta', 'wrong_cluster');
  return movementResult('deposit', built, sent.signature);
}

async function balanceOf(client, wallet, balances) {
  if (balances != null) {
    if (typeof balances !== 'object' || !Object.hasOwn(balances, wallet.id)) {
      fail('A mainnet-beta USDC balance is required for each wallet', 'missing_balance');
    }
    return amount(balances[wallet.id]);
  }
  requireMethod(client, 'getSolanaUsdcBalance');
  const read = await client.getSolanaUsdcBalance({ address: wallet.address });
  if (!read || read.cluster !== SOLANA_CLUSTER || read.mint !== SOLANA_USDC_MINT || read.address !== wallet.address) {
    fail('Refusing to read a balance outside Solana mainnet-beta USDC', 'wrong_cluster');
  }
  return amount(read.amount);
}

export async function grabBackToMain({
  client,
  ownerId,
  mainWallet,
  wallets,
  balances = null,
  memo = 'funds.grabbed',
  recentBlockhash,
} = {}) {
  const main = ownedWallet(mainWallet, ownerId);
  if (main.kind !== 'main') fail('Grab-back returns funds to the main wallet', 'invalid_wallet');
  if (!Array.isArray(wallets)) fail('Additional wallets are required', 'invalid_wallet');
  memoBytes(memo);
  const moves = [];
  const seen = new Set();
  for (const wallet of wallets) {
    const source = ownedWallet(wallet, ownerId);
    if (source.kind !== 'additional') fail('Grab-back sweeps additional wallets', 'invalid_wallet');
    if (source.id === main.id || source.address === main.address) fail('Source and destination must differ', 'invalid_destination');
    if (seen.has(source.id)) fail('Duplicate grab-back source', 'duplicate_wallet');
    seen.add(source.id);
    const units = await balanceOf(client, source, balances);
    if (units === 0n) continue;
    try {
      moves.push(await ownerMove({
        client,
        ownerId,
        fromWallet: source,
        toAddress: main.address,
        amount: units.toString(),
        memo,
        recentBlockhash,
        kind: 'grab-back',
      }));
    } catch (error) {
      const wrapped = new TransferError(error.message, error.code ?? 'grab_back_failed');
      wrapped.completed = moves;
      throw wrapped;
    }
  }
  return { kind: 'grab-back', cluster: SOLANA_CLUSTER, memo, moves };
}
