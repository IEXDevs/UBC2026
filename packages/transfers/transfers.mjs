/**
 * Devnet USDC movement for Maelstrom.
 * Privy signs bot transfers and owner moves, then the existing devnet
 * broadcaster sends them. A Wallet Adapter signs deposits locally.
 * Every transaction is a USDC transfer followed by a memo.
 * This module never opens a Solana connection and never broadcasts.
 */
import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { ContractError, validateWallet } from '@ubc2026/contracts';
import { assertSpendAllowed } from '@ubc2026/wallets';
import { DEVNET_USDC_MINT } from '@ubc2026/wallets/privy';
import { DEVNET_USDC_MINT as X402_DEVNET_USDC_MINT } from '@ubc2026/x402';

if (DEVNET_USDC_MINT !== X402_DEVNET_USDC_MINT) {
  throw new Error('Devnet USDC mint does not match @ubc2026/x402');
}

export { DEVNET_USDC_MINT };

export const SPL_TOKEN_PROGRAM_ID = TOKEN_PROGRAM_ID.toBase58();
export const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export const ASSOCIATED_TOKEN_PROGRAM = ASSOCIATED_TOKEN_PROGRAM_ID.toBase58();
export const DEVNET_USDC_DECIMALS = 6;
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
  if (!client || typeof client[name] !== 'function') fail(`Devnet signing helper ${name} is required`, 'missing_signer');
}

async function blockhashFrom(client, recentBlockhash) {
  if (recentBlockhash != null && recentBlockhash !== '') {
    pubkey(recentBlockhash, 'blockhash');
    return recentBlockhash;
  }
  requireMethod(client, 'getDevnetBlockhash');
  const loaded = await client.getDevnetBlockhash();
  if (!loaded || loaded.cluster !== 'devnet') fail('Refusing to build a transfer outside Solana devnet', 'wrong_cluster');
  pubkey(loaded.blockhash, 'blockhash');
  return loaded.blockhash;
}

function tokenAccount(owner) {
  return getAssociatedTokenAddressSync(
    pubkey(DEVNET_USDC_MINT, 'mint'),
    owner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}

/**
 * Unsigned legacy transaction: create the destination USDC account if needed,
 * transfer devnet USDC, then write the memo. Nothing is signed or sent.
 */
export function buildDevnetUsdcTransaction({
  feePayer,
  sourceOwner,
  destinationOwner,
  amount: rawAmount,
  memo,
  recentBlockhash,
  cluster = 'devnet',
} = {}) {
  if (cluster !== 'devnet') fail('Hackathon transfers must use Solana devnet', 'wrong_cluster');
  const units = positiveAmount(rawAmount);
  const memoData = memoBytes(memo);
  const payer = pubkey(feePayer, 'fee payer');
  const source = pubkey(sourceOwner, 'source wallet');
  const destination = pubkey(destinationOwner, 'destination wallet');
  pubkey(recentBlockhash, 'blockhash');
  if (source.equals(destination)) fail('Source and destination must differ', 'invalid_destination');

  const sourceTokenAccount = tokenAccount(source);
  const destinationTokenAccount = tokenAccount(destination);
  const mint = pubkey(DEVNET_USDC_MINT, 'mint');
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
      DEVNET_USDC_DECIMALS,
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
    cluster: 'devnet',
    mint: DEVNET_USDC_MINT,
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

function movementResult(kind, built, signature) {
  return {
    kind,
    cluster: 'devnet',
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

export async function transferDevnetUsdc({
  client,
  bot,
  wallet,
  destination,
  amount: rawAmount,
  memo,
  recentBlockhash,
} = {}) {
  requireMethod(client, 'signAndBroadcastDevnet');
  assertSpendAllowed({ bot, wallet });
  if (wallet.address === destination) fail('Source and destination must differ', 'invalid_destination');
  const hash = await blockhashFrom(client, recentBlockhash);
  const built = buildDevnetUsdcTransaction({
    feePayer: wallet.address,
    sourceOwner: wallet.address,
    destinationOwner: destination,
    amount: rawAmount,
    memo,
    recentBlockhash: hash,
  });
  const sent = await client.signAndBroadcastDevnet({
    bot,
    wallet,
    transaction: built.transactionBase64,
  });
  if (!sent || sent.cluster !== 'devnet') fail('Refusing to broadcast outside Solana devnet', 'wrong_cluster');
  return movementResult('transfer', built, sent.signature);
}

async function ownerMove({
  client,
  ownerId,
  fromWallet,
  toAddress,
  amount: rawAmount,
  memo,
  recentBlockhash,
  kind,
}) {
  requireMethod(client, 'signAndBroadcastOwnerDevnet');
  const source = ownedWallet(fromWallet, ownerId);
  if (source.address === toAddress) fail('Source and destination must differ', 'invalid_destination');
  const hash = await blockhashFrom(client, recentBlockhash);
  const built = buildDevnetUsdcTransaction({
    feePayer: source.address,
    sourceOwner: source.address,
    destinationOwner: toAddress,
    amount: rawAmount,
    memo,
    recentBlockhash: hash,
  });
  const sent = await client.signAndBroadcastOwnerDevnet({
    ownerId,
    wallet: source,
    transaction: built.transactionBase64,
  });
  if (!sent || sent.cluster !== 'devnet') fail('Refusing to broadcast outside Solana devnet', 'wrong_cluster');
  return movementResult(kind, built, sent.signature);
}

export async function moveBetweenWallets({
  client,
  ownerId,
  fromWallet,
  toWallet,
  amount: rawAmount,
  memo = 'wallet.move',
  recentBlockhash,
} = {}) {
  const destination = ownedWallet(toWallet, ownerId);
  if (fromWallet?.id === destination.id) fail('Source and destination must differ', 'invalid_destination');
  return ownerMove({
    client,
    ownerId,
    fromWallet,
    toAddress: destination.address,
    amount: rawAmount,
    memo,
    recentBlockhash,
    kind: 'move',
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
  requireMethod(client, 'assertDevnetCluster');
  requireMethod(client, 'broadcastSignedDevnet');
  const main = ownedWallet(mainWallet, ownerId);
  if (main.kind !== 'main') fail('Deposits go to the main wallet', 'invalid_wallet');
  if (!adapter || typeof adapter.signTransaction !== 'function') {
    fail('Wallet adapter signTransaction is required', 'missing_signer');
  }
  const external = adapterAddress(adapter);
  const hash = await blockhashFrom(client, recentBlockhash);
  const built = buildDevnetUsdcTransaction({
    feePayer: external,
    sourceOwner: external,
    destinationOwner: main.address,
    amount: rawAmount,
    memo,
    recentBlockhash: hash,
  });
  await client.assertDevnetCluster();
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
  const sent = await client.broadcastSignedDevnet({ signedTransaction: transactionBase64 });
  if (!sent || sent.cluster !== 'devnet') fail('Refusing to broadcast outside Solana devnet', 'wrong_cluster');
  return movementResult('deposit', built, sent.signature);
}

async function balanceOf(client, wallet, balances) {
  if (balances != null) {
    if (typeof balances !== 'object' || !Object.hasOwn(balances, wallet.id)) {
      fail('A devnet USDC balance is required for each wallet', 'missing_balance');
    }
    return amount(balances[wallet.id]);
  }
  requireMethod(client, 'getDevnetUsdcBalance');
  const read = await client.getDevnetUsdcBalance({ address: wallet.address });
  if (!read || read.cluster !== 'devnet' || read.mint !== DEVNET_USDC_MINT || read.address !== wallet.address) {
    fail('Refusing to read a balance outside Solana devnet USDC', 'wrong_cluster');
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
  return { kind: 'grab-back', cluster: 'devnet', memo, moves };
}
