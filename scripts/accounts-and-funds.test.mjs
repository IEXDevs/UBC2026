import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SECRET_NAMES } from '../packages/contracts/contracts.mjs';
import { SOLANA_USDC_MINT } from '../packages/x402/x402.mjs';
import {
  ACCOUNT_VENDORS,
  AccountsFundsError,
  SOLANA_USDC_MINT_ADDRESS,
  PUBLIC_SOLANA_RPC,
  SOL_FAUCET_URL,
  USDC_FAUCET_URL,
  assertSecretNamesCovered,
  assertSolanaAddress,
  buildAccountsAndFundsPlan,
  decodeBase58,
  formatAccountsAndFunds,
  isSolanaAddress,
  runAccountsAndFunds,
} from './accounts-and-funds.mjs';

const ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SECRET_VALUE = 'super-secret-value-do-not-print';

/**
 * Achieves: isSolanaAddress accepts a valid base58 pubkey and rejects empty/junk/too-long.
 * Fails when: Junk or length+1 addresses pass.
 * Oracle: Base58 32-byte pubkey check.
 * Side effects: none
 * Gaps: Does not decode checksum beyond length/alphabet heuristics if any.
 */
test('solana address check accepts a 32-byte pubkey and rejects junk', () => {
  assert.equal(isSolanaAddress(ADDRESS), true);
  assert.equal(isSolanaAddress('not-an-address'), false);
  assert.equal(isSolanaAddress(`${ADDRESS}1`), false);
  assert.equal(isSolanaAddress(''), false);
});

/**
 * Achieves: Plan lists all SECRET_NAMES/faucets, storesValues/networkCalls false, and format redacts env secret values/RPC paths.
 * Fails when: Secret values or private RPC URLs appear in formatted output, or a secret name is missing.
 * Oracle: SECRET_NAMES from contracts + public faucet URLs.
 * Side effects: Reads process.env PRIVY/QUICKNODE test values.
 * Gaps: Does not unset env in finally (test process local).
 */
test('plan lists every secret name and real funding steps without reading values', () => {
  process.env.PRIVY_APP_SECRET = SECRET_VALUE;
  process.env.SOLANA_RPC_URL = 'https://example.invalid/secret-rpc';
  const plan = buildAccountsAndFundsPlan();
  const listed = ACCOUNT_VENDORS.flatMap(vendor => vendor.names);
  for (const name of SECRET_NAMES) assert.ok(listed.includes(name), name);
  assert.equal(plan.storesValues, false);
  assert.equal(plan.networkCalls, false);
  assert.equal(plan.wallet, null);
  assert.equal(plan.funds.sol.url, null);
  assert.equal(plan.funds.usdc.url, null);
  assert.equal(plan.funds.usdc.mint, SOLANA_USDC_MINT);
  assert.equal(SOLANA_USDC_MINT_ADDRESS, SOLANA_USDC_MINT);
  const text = formatAccountsAndFunds(plan);
  assert.match(text, /real mainnet SOL/);
  assert.match(text, /real Solana mainnet USDC/);
  assert.doesNotMatch(text, /solana airdrop|faucet\.solana\.com|faucet\.circle\.com/);
  assert.match(text, new RegExp(PUBLIC_SOLANA_RPC.replace(/[.]/g, '\\.')));
  assert.match(text, /\$SOLANA_RPC_URL/);
  assert.equal(text.includes(SECRET_VALUE), false);
  assert.equal(text.includes('https://example.invalid/secret-rpc'), false);
  for (const name of [...SECRET_NAMES, 'NEXT_PUBLIC_PRIVY_APP_ID', 'NEXT_PUBLIC_PRIVY_CLIENT_ID']) {
    assert.match(text, new RegExp(name));
  }
  assert.equal(text.includes('NEXT_PUBLIC_AGENT_RUNTIME_URL'), false);
});

/**
 * Achieves: Valid address is embedded in faucet steps; invalid address throws AccountsFundsError.
 * Fails when: Bad addresses are interpolated into steps.
 * Oracle: isSolanaAddress gate on plan.wallet.
 * Side effects: none
 * Gaps: none meaningful
 */
test('a public address is filled into faucet steps and a bad address is refused', () => {
  const plan = buildAccountsAndFundsPlan({ address: ADDRESS });
  assert.equal(plan.wallet, ADDRESS);
  assert.ok(plan.funds.sol.steps.some(step => step.includes(ADDRESS)));
  assert.ok(plan.funds.usdc.steps.some(step => step.includes(ADDRESS)));
  assert.throws(() => buildAccountsAndFundsPlan({ address: 'privy-secret' }), AccountsFundsError);
});

/**
 * Achieves: Every ACCOUNT_VENDORS name appears as NAME= with empty value; no secret literals.
 * Fails when: Example ships a non-empty assignment or omits a vendor name.
 * Oracle: .env.example as the empty-secret template.
 * Side effects: Reads .env.example from disk.
 * Gaps: Does not validate apps/* env examples.
 */
test('.env.example keeps every listed name empty', () => {
  const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  const names = new Set(ACCOUNT_VENDORS.flatMap(vendor => vendor.names));
  for (const name of names) assert.match(example, new RegExp(`^${name}=$`, 'm'));
  const assignments = example.replaceAll('\r', '').split('\n').filter(line => /^[A-Z0-9_]+=/.test(line));
  assert.ok(assignments.every(line => line.endsWith('=')));
  assert.equal(example.includes(SECRET_VALUE), false);
});

/**
 * Achieves: CLI --json succeeds with clean env, refuses bad addresses, and runAccountsAndFunds keeps storesValues false.
 * Fails when: Nonzero exit on good input, or secrets appear in stdout.
 * Oracle: scripts/accounts-and-funds.mjs CLI contract.
 * Side effects: Spawns a child node process.
 * Gaps: none meaningful
 */
test('cli prints json with no secrets in the environment', () => {
  const result = spawnSync(process.execPath, ['scripts/accounts-and-funds.mjs', '--json', '--address', ADDRESS], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.wallet, ADDRESS);
  assert.equal(plan.networkCalls, false);
  assert.equal(plan.funds.usdc.mint, SOLANA_USDC_MINT);
  assert.equal(result.stdout.includes(SECRET_VALUE), false);
  const refused = spawnSync(process.execPath, ['scripts/accounts-and-funds.mjs', '--address', 'nope'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
  });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /public address/);
  const rendered = runAccountsAndFunds(['--address', ADDRESS]);
  assert.equal(rendered.plan.storesValues, false);
});

/**
 * Achieves: decodeBase58 returns 32-byte pubkeys; assertSolanaAddress throws AccountsFundsError on junk.
 * Fails when: Non-base58 or wrong-length values decode as 32 bytes, or assert soft-fails.
 * Oracle: ADDRESS fixture length 32; independent junk samples.
 * Side effects: none.
 * Gaps: does not verify ed25519 point-on-curve.
 */
test('decodeBase58 and assertSolanaAddress enforce 32-byte base58 pubkeys', () => {
  const decoded = decodeBase58(ADDRESS);
  assert.equal(decoded instanceof Uint8Array, true);
  assert.equal(decoded.length, 32);
  assert.equal(decodeBase58('not-an-address'), null);
  assert.equal(decodeBase58(''), null);
  assert.equal(decodeBase58('0'.repeat(32)), null);
  assert.equal(decodeBase58(`${ADDRESS}1`), null);
  assert.equal(assertSolanaAddress(ADDRESS), ADDRESS);
  assert.throws(() => assertSolanaAddress('nope'), AccountsFundsError);
  assert.throws(() => assertSolanaAddress(''), AccountsFundsError);
});

/**
 * Achieves: assertSecretNamesCovered passes when ACCOUNT_VENDORS list every SECRET_NAMES entry.
 * Fails when: A contracts SECRET_NAMES entry is missing from vendor name lists.
 * Oracle: SECRET_NAMES ⊆ ACCOUNT_VENDORS.flatMap(names).
 * Side effects: none.
 * Gaps: does not prove dashboard steps stay current with vendor UIs.
 */
test('assertSecretNamesCovered requires every SECRET_NAMES entry in ACCOUNT_VENDORS', () => {
  assert.doesNotThrow(() => assertSecretNamesCovered());
  const listed = new Set(ACCOUNT_VENDORS.flatMap(vendor => vendor.names));
  for (const name of SECRET_NAMES) assert.ok(listed.has(name), name);
});
