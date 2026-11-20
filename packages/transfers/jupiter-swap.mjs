import { createHash } from 'node:crypto';
import {
  AddressLookupTableAccount, ComputeBudgetProgram, PublicKey, SystemInstruction,
  SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction,
} from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';

const JUPITER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const WRAPPED_SOL = new PublicKey('So11111111111111111111111111111111111111112');
const UNITS = /^[1-9][0-9]{0,19}$/;
const MAX_U64 = (1n << 64n) - 1n;
const SLIPPAGE_BPS = 50;
const EXACT_IN = new Map(Object.entries({
  route: { authority: 1, mint: 5, trailingTerms: true },
  shared_accounts_route: { authority: 2, mint: 8, trailingTerms: true },
  route_v2: { authority: 0, mint: 4, amountOffset: 8 },
  shared_accounts_route_v2: { authority: 1, mint: 7, amountOffset: 9 },
}).map(([name, layout]) => [createHash('sha256').update(`global:${name}`).digest('hex').slice(0, 16), layout]));

function refused() {
  throw new Error('swap_route_refused');
}

function positiveU64(value) {
  return typeof value === 'string' && UNITS.test(value) && BigInt(value) <= MAX_U64;
}

function jupiterInstruction(raw) {
  if (typeof raw?.data !== 'string' || !Array.isArray(raw.accounts) || raw.accounts.length > 128) refused();
  return new TransactionInstruction({
    programId: new PublicKey(raw.programId),
    keys: raw.accounts.map(account => ({
      pubkey: new PublicKey(account.pubkey),
      isSigner: account.isSigner === true,
      isWritable: account.isWritable === true,
    })),
    data: Buffer.from(raw.data, 'base64'),
  });
}

function allowedSetup(ix, taker, nativeAccount, inputMint, outputMint, amount) {
  const key = index => ix.keys[index]?.pubkey;
  if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
    return ix.data.length <= 1 && (ix.data.length === 0 || ix.data[0] <= 1)
      && key(0)?.equals(taker) && key(2)?.equals(taker)
      && [inputMint, outputMint].includes(key(3)?.toBase58());
  }
  if (ix.programId.equals(SystemProgram.programId) && inputMint === WRAPPED_SOL.toBase58()) {
    const transfer = SystemInstruction.decodeTransfer(ix);
    return transfer.fromPubkey.equals(taker) && transfer.toPubkey.equals(nativeAccount)
      && BigInt(transfer.lamports) === BigInt(amount);
  }
  return ix.programId.equals(TOKEN_PROGRAM_ID) && ix.data.length === 1 && ix.data[0] === 17
    && key(0)?.equals(nativeAccount);
}

function matchesSwapQuote(ix, taker, quote) {
  if (ix.programId.toBase58() !== JUPITER) return false;
  const layout = EXACT_IN.get(ix.data.subarray(0, 8).toString('hex'));
  const signer = ix.keys[layout?.authority];
  if (!layout || !signer?.isSigner || !signer.pubkey.equals(taker)
      || ix.keys[layout.mint]?.pubkey.toBase58() !== quote.outputMint) return false;

  // Legacy routes put the fixed-width terms after the plan. V2 puts them before it.
  const offset = layout.trailingTerms ? ix.data.length - 19 : layout.amountOffset;
  const minimumLength = layout.trailingTerms ? 31 : offset + 26;
  if (ix.data.length < minimumLength) return false;
  const amount = ix.data.readBigUInt64LE(offset);
  const out = ix.data.readBigUInt64LE(offset + 8);
  const slippage = ix.data.readUInt16LE(offset + 16);
  const platformFee = layout.trailingTerms ? ix.data[offset + 18] : ix.data.readUInt16LE(offset + 18);
  const threshold = (out * (10_000n - BigInt(slippage)) + 9_999n) / 10_000n;
  return amount === BigInt(quote.inAmount) && out === BigInt(quote.outAmount)
    && slippage === SLIPPAGE_BPS && platformFee === 0 && threshold >= BigInt(quote.otherAmountThreshold);
}

export async function buildJupiterSwap({
  inputMint, outputMint, amount, walletAddress, blockhash, apiKey, fetcher = fetch,
} = {}) {
  if (!apiKey || !positiveU64(amount) || inputMint === outputMint) refused();
  const taker = new PublicKey(walletAddress);
  const nativeAccount = getAssociatedTokenAddressSync(WRAPPED_SOL, taker);
  const query = new URLSearchParams({
    inputMint, outputMint, amount, taker: walletAddress, slippageBps: String(SLIPPAGE_BPS),
    transactionVersion: '0', computeUnitPricePercentile: 'medium',
  });
  const response = await fetcher(`https://api.jup.ag/swap/v2/build?${query}`, {
    headers: { accept: 'application/json', 'x-api-key': apiKey },
    redirect: 'manual',
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    const error = new Error('Jupiter quote request failed');
    error.code = `jupiter_http_${response.status}`;
    throw error;
  }
  const result = await response.json();
  if (result.inputMint !== inputMint || result.outputMint !== outputMint || result.inAmount !== amount
      || result.swapMode !== 'ExactIn' || result.slippageBps !== SLIPPAGE_BPS || !positiveU64(result.outAmount)
      || !positiveU64(result.otherAmountThreshold) || BigInt(result.otherAmountThreshold) > BigInt(result.outAmount)
      || BigInt(result.otherAmountThreshold) < BigInt(result.outAmount) * 9950n / 10000n
      || result.tipInstruction || result.otherInstructions?.length) refused();
  const compute = (result.computeBudgetInstructions ?? []).map(jupiterInstruction);
  if (compute.length > 1 || compute.some(ix => !ix.programId.equals(ComputeBudgetProgram.programId)
      || ix.data.length !== 9 || ix.data[0] !== 3)) refused();
  const setup = (result.setupInstructions ?? []).map(jupiterInstruction);
  if (!setup.every(ix => allowedSetup(ix, taker, nativeAccount, inputMint, outputMint, amount))) refused();
  const swap = jupiterInstruction(result.swapInstruction);
  if (!matchesSwapQuote(swap, taker, result)) refused();
  const cleanup = result.cleanupInstruction ? [jupiterInstruction(result.cleanupInstruction)] : [];
  if (cleanup.some(ix => !ix.programId.equals(TOKEN_PROGRAM_ID) || ix.data.length !== 1 || ix.data[0] !== 9
      || !ix.keys[0]?.pubkey.equals(nativeAccount) || !ix.keys[1]?.pubkey.equals(taker)
      || !ix.keys[2]?.pubkey.equals(taker))) refused();
  const lookups = Object.entries(result.addressesByLookupTableAddress ?? {}).map(([address, contents]) => (
    new AddressLookupTableAccount({
      key: new PublicKey(address),
      state: {
        deactivationSlot: MAX_U64,
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        addresses: contents.map(key => new PublicKey(key)),
      },
    })
  ));
  const message = new TransactionMessage({
    payerKey: taker, recentBlockhash: blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...compute, ...setup, swap, ...cleanup],
  }).compileToV0Message(lookups);
  if (message.header.numRequiredSignatures !== 1) refused();
  const bytes = new VersionedTransaction(message).serialize();
  if (bytes.length > 1232) refused();
  return { transaction: Buffer.from(bytes).toString('base64'), minOutput: result.otherAmountThreshold };
}
