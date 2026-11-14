import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SECRET_NAMES } from '../packages/contracts/contracts.mjs';
import { DEVNET_USDC_MINT } from '../packages/x402/x402.mjs';
import {
  ACCOUNT_VENDORS,
  AccountsFundsError,
  DEVNET_USDC_MINT_ADDRESS,
  PUBLIC_DEVNET_RPC,
  SOL_FAUCET_URL,
  USDC_FAUCET_URL,
  buildAccountsAndFundsPlan,
  formatAccountsAndFunds,
  isSolanaAddress,
  runAccountsAndFunds,
} from './accounts-and-funds.mjs';

const ADDRESS = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const SECRET_VALUE = 'super-secret-value-do-not-print';

test('solana address check accepts a 32-byte pubkey and rejects junk', () => {
  assert.equal(isSolanaAddress(ADDRESS), true);
  assert.equal(isSolanaAddress('not-an-address'), false);
  assert.equal(isSolanaAddress(`${ADDRESS}1`), false);
  assert.equal(isSolanaAddress(''), false);
});

test('plan lists every secret name and both faucets without reading values', () => {
  process.env.PRIVY_APP_SECRET = SECRET_VALUE;
  process.env.QUICKNODE_DEVNET_RPC_URL = 'https://example.invalid/secret-rpc';
  const plan = buildAccountsAndFundsPlan();
  const listed = ACCOUNT_VENDORS.flatMap(vendor => vendor.names);
  for (const name of SECRET_NAMES) assert.ok(listed.includes(name), name);
  assert.equal(plan.storesValues, false);
  assert.equal(plan.networkCalls, false);
  assert.equal(plan.wallet, null);
  assert.equal(plan.funds.sol.url, SOL_FAUCET_URL);
  assert.equal(plan.funds.usdc.url, USDC_FAUCET_URL);
  assert.equal(plan.funds.usdc.mint, DEVNET_USDC_MINT);
  assert.equal(DEVNET_USDC_MINT_ADDRESS, DEVNET_USDC_MINT);
  const text = formatAccountsAndFunds(plan);
  assert.match(text, /faucet\.solana\.com/);
  assert.match(text, /faucet\.circle\.com/);
  assert.match(text, new RegExp(PUBLIC_DEVNET_RPC.replace(/[.]/g, '\\.')));
  assert.match(text, /HTTP 410/);
  assert.match(text, /\$QUICKNODE_DEVNET_RPC_URL/);
  assert.equal(text.includes(SECRET_VALUE), false);
  assert.equal(text.includes('https://example.invalid/secret-rpc'), false);
  for (const name of [...SECRET_NAMES, 'NEXT_PUBLIC_PRIVY_APP_ID', 'NEXT_PUBLIC_PRIVY_CLIENT_ID']) {
    assert.match(text, new RegExp(name));
  }
  assert.equal(text.includes('NEXT_PUBLIC_AGENT_RUNTIME_URL'), false);
});

test('a public address is filled into faucet steps and a bad address is refused', () => {
  const plan = buildAccountsAndFundsPlan({ address: ADDRESS });
  assert.equal(plan.wallet, ADDRESS);
  assert.ok(plan.funds.sol.steps.some(step => step.includes(ADDRESS)));
  assert.ok(plan.funds.usdc.steps.some(step => step.includes(ADDRESS)));
  assert.throws(() => buildAccountsAndFundsPlan({ address: 'privy-secret' }), AccountsFundsError);
});

test('.env.example keeps every listed name empty', () => {
  const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  const names = new Set(ACCOUNT_VENDORS.flatMap(vendor => vendor.names));
  for (const name of names) assert.match(example, new RegExp(`^${name}=$`, 'm'));
  const assignments = example.replaceAll('\r', '').split('\n').filter(line => /^[A-Z0-9_]+=/.test(line));
  assert.ok(assignments.every(line => line.endsWith('=')));
  assert.equal(example.includes(SECRET_VALUE), false);
});

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
  assert.equal(plan.funds.usdc.mint, DEVNET_USDC_MINT);
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
