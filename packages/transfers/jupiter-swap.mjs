import { createHash } from 'node:crypto';
import {
  AddressLookupTableAccount, ComputeBudgetProgram, PublicKey, SystemInstruction,
  SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction,
} from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';

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

function refused(code = 'swap_route_refused') {
  const error = new Error(code);
  error.code = code;
  throw error;
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

function allowedSetup(ix, taker, nativeAccount, inputMint, outputMint, amount, intermediateMints, swap) {
  const key = index => ix.keys[index]?.pubkey;
  if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
    const mint = key(3);
    const tokenProgram = key(5);
    if (ix.data.length > 1 || (ix.data.length === 1 && ix.data[0] > 1)
        || !key(0)?.equals(taker) || !key(2)?.equals(taker) || !key(4)?.equals(SystemProgram.programId)
        || !mint || !(tokenProgram?.equals(TOKEN_PROGRAM_ID) || tokenProgram?.equals(TOKEN_2022_PROGRAM_ID))) return false;
    const associated = getAssociatedTokenAddressSync(mint, taker, false, tokenProgram);
    if (!key(1)?.equals(associated)) return false;
    const address = mint.toBase58();
    return address === inputMint || address === outputMint || (intermediateMints.has(address)
      && swap.keys.some(account => account.isWritable && account.pubkey.equals(associated)));
  }
  if (ix.programId.equals(SystemProgram.programId) && inputMint === WRAPPED_SOL.toBase58()) {
    const transfer = SystemInstruction.decodeTransfer(ix);
    return transfer.fromPubkey.equals(taker) && transfer.toPubkey.equals(nativeAccount)
      && BigInt(transfer.lamports) === BigInt(amount);
  }
  return ix.programId.equals(TOKEN_PROGRAM_ID) && ix.data.length === 1 && ix.data[0] === 17
    && key(0)?.equals(nativeAccount);
}

function intermediateRouteMints(routePlan) {
  const legs = Array.isArray(routePlan) ? routePlan.map(leg => leg?.swapInfo) : [];
  const inputs = new Set(legs.map(leg => leg?.inputMint));
  return new Set(legs.map(leg => leg?.outputMint).filter(mint => typeof mint === 'string' && inputs.has(mint)));
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
  let response;
  try {
    response = await fetcher(`https://api.jup.ag/swap/v2/build?${query}`, {
      headers: { accept: 'application/json', 'x-api-key': apiKey },
      // Workers reject redirect: 'error'. Keep the API key on this origin.
      redirect: 'manual',
      signal: AbortSignal.timeout(12_000),
    });
  } catch (error) {
    refused(error?.name === 'TimeoutError' || error?.name === 'AbortError'
      ? 'jupiter_quote_timeout' : 'jupiter_quote_transport');
  }
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    refused('jupiter_redirect_refused');
  }
  if (!response.ok) refused(`jupiter_http_${response.status}`);
  const result = await response.json().catch(() => null);
  if (!result || typeof result !== 'object' || Array.isArray(result)) refused('jupiter_quote_invalid_response');
  if (result.inputMint !== inputMint || result.outputMint !== outputMint || result.inAmount !== amount
      || result.swapMode !== 'ExactIn' || result.slippageBps !== SLIPPAGE_BPS || !positiveU64(result.outAmount)
      || !positiveU64(result.otherAmountThreshold) || BigInt(result.otherAmountThreshold) > BigInt(result.outAmount)
      || BigInt(result.otherAmountThreshold) < BigInt(result.outAmount) * 9950n / 10000n) refused('swap_quote_terms_mismatch');
  if (result.tipInstruction || result.otherInstructions?.length) refused('swap_route_extra_instructions');
  const compute = (result.computeBudgetInstructions ?? []).map(jupiterInstruction);
  if (compute.length > 1 || compute.some(ix => !ix.programId.equals(ComputeBudgetProgram.programId)
      || ix.data.length !== 9 || ix.data[0] !== 3)) refused('swap_route_compute_invalid');
  const swap = jupiterInstruction(result.swapInstruction);
  if (!matchesSwapQuote(swap, taker, result)) refused('swap_route_instruction_mismatch');
  const setup = (result.setupInstructions ?? []).map(jupiterInstruction);
  const intermediateMints = intermediateRouteMints(result.routePlan);
  if (!setup.every(ix => allowedSetup(ix, taker, nativeAccount, inputMint, outputMint, amount, intermediateMints, swap))) refused('swap_route_setup_invalid');
  const cleanup = result.cleanupInstruction ? [jupiterInstruction(result.cleanupInstruction)] : [];
  if (cleanup.some(ix => !ix.programId.equals(TOKEN_PROGRAM_ID) || ix.data.length !== 1 || ix.data[0] !== 9
      || !ix.keys[0]?.pubkey.equals(nativeAccount) || !ix.keys[1]?.pubkey.equals(taker)
      || !ix.keys[2]?.pubkey.equals(taker))) refused('swap_route_cleanup_invalid');
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
  if (message.header.numRequiredSignatures !== 1) refused('swap_route_signers_invalid');
  const bytes = new VersionedTransaction(message).serialize();
  if (bytes.length > 1232) refused('swap_route_too_large');
  return { transaction: Buffer.from(bytes).toString('base64'), minOutput: result.otherAmountThreshold };
}
