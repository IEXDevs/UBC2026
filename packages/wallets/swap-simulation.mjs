import { PublicKey } from '@solana/web3.js';

const NATIVE_MINT = 'So11111111111111111111111111111111111111112';
const UNITS = /^(0|[1-9][0-9]{0,19})$/;
const MAX_EXTRA_LAMPORTS = 5_000_000n;
const TOKEN_PROGRAMS = new Set(['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']);

export function swapAccountSnapshot(accounts, wallet) {
  if (!Array.isArray(accounts) || !accounts[0] || !Number.isSafeInteger(accounts[0].lamports)) return null;
  const tokens = [];
  for (const account of accounts) {
    if (!account || !TOKEN_PROGRAMS.has(account.owner)) continue;
    if (account.data?.[1] !== 'base64') return null;
    const bytes = Buffer.from(account.data[0], 'base64');
    if (bytes.length === 82) continue;
    if (bytes.length < 165) return null;
    if (account.owner === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' && bytes.length !== 165) continue;
    if (bytes.length > 165 && bytes[165] !== 2) continue;
    const owner = new PublicKey(bytes.subarray(32, 64)).toBase58();
    if (owner === wallet) tokens.push({ owner, mint: new PublicKey(bytes.subarray(0, 32)).toBase58(), uiTokenAmount: { amount: bytes.readBigUInt64LE(64).toString() } });
  }
  return { lamports: accounts[0].lamports, tokens };
}

function sumWalletTokens(entries, wallet) {
  const totals = new Map();
  for (const row of entries) {
    if (row?.owner !== wallet) continue;
    if (typeof row.mint !== 'string' || !UNITS.test(row.uiTokenAmount?.amount ?? '')) return null;
    totals.set(row.mint, (totals.get(row.mint) ?? 0n) + BigInt(row.uiTokenAmount.amount));
  }
  return totals;
}

export function verifySwapSimulation(simulation, { wallet, inputMint, outputMint, amount, minOutput }) {
  if (simulation?.err !== null || !Array.isArray(simulation.preTokenBalances) || !Array.isArray(simulation.postTokenBalances)
      || !UNITS.test(amount) || !UNITS.test(minOutput) || inputMint === outputMint) return { reason: 'swap_effects_unverifiable' };
  if (!Number.isSafeInteger(simulation.fee) || simulation.fee < 1) return { reason: 'swap_fee_unavailable' };
  const before = simulation.preBalances?.[0];
  const after = simulation.postBalances?.[0];
  if (!Number.isSafeInteger(before) || !Number.isSafeInteger(after) || before < 0 || after < 0) return { reason: 'swap_effects_unverifiable' };
  const fee = BigInt(simulation.fee);
  const solChange = BigInt(after) - BigInt(before);
  const beforeTokens = sumWalletTokens(simulation.preTokenBalances, wallet);
  const afterTokens = sumWalletTokens(simulation.postTokenBalances, wallet);
  if (!beforeTokens || !afterTokens) return { reason: 'swap_effects_unverifiable' };
  const delta = mint => (afterTokens.get(mint) ?? 0n) - (beforeTokens.get(mint) ?? 0n);
  for (const mint of new Set([...beforeTokens.keys(), ...afterTokens.keys()])) {
    if (delta(mint) === 0n) continue;
    if (mint === NATIVE_MINT) return { reason: 'swap_wrapped_sol_changed' };
    if (mint !== inputMint && mint !== outputMint) return { reason: 'swap_other_token_changed' };
  }
  const input = BigInt(amount);
  const minimum = BigInt(minOutput);
  if (input === 0n || minimum === 0n) return { reason: 'swap_effects_unverifiable' };
  if (inputMint !== NATIVE_MINT && delta(inputMint) !== -input) return { reason: 'swap_input_mismatch' };
  const output = outputMint === NATIVE_MINT ? solChange + fee : delta(outputMint);
  if (output < minimum) return { reason: 'swap_output_below_minimum' };

  const solCost = outputMint === NATIVE_MINT ? fee : -solChange - (inputMint === NATIVE_MINT ? input : 0n);
  if (solCost < fee) return { reason: 'swap_sol_debit_below_fee' };
  if (solCost > MAX_EXTRA_LAMPORTS) return { reason: 'swap_sol_cost_above_limit' };
  return { feeLamports: fee.toString(), maxSolCost: solCost.toString() };
}
