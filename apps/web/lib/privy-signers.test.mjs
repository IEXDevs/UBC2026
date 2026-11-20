import assert from 'node:assert/strict';
import test from 'node:test';
import { serverSignerFailure, privySignerId, walletsNeedingSigner } from './privy-signers.mjs';

const A = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const B = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const C = 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH';

test('server signer diagnostics retain safe status and code without raw provider text', () => {
  assert.deepEqual(serverSignerFailure({ status: 403, code: 'forbidden', error: 'Permission denied https://private.example/token' }), {
    status: 403, code: 'forbidden', message: 'Privy denied permission to add this signer.',
  });
  assert.deepEqual(serverSignerFailure(null), { code: 'unknown', message: 'Privy rejected adding the server signer.' });
  assert.deepEqual(serverSignerFailure({ status: 999, code: 'Bearer secret', message: 'secret' }), {
    code: 'unknown', message: 'Privy rejected adding the server signer.',
  });
});

test('privySignerId accepts key quorum ids only', () => {
  assert.equal(privySignerId(' cm1abcdefghijklmnopqrstu '), 'cm1abcdefghijklmnopqrstu');
  assert.equal(privySignerId('short'), '');
  assert.equal(privySignerId('has space in it'), '');
  assert.equal(privySignerId(undefined), '');
});

test('walletsNeedingSigner lists undelegated Privy Solana wallets once', () => {
  const user = {
    linkedAccounts: [
      { type: 'wallet', walletClientType: 'privy', chainType: 'solana', address: A, delegated: false },
      { type: 'wallet', walletClientType: 'privy', chainType: 'solana', address: B, delegated: true },
      { type: 'wallet', walletClientType: 'phantom', chainType: 'solana', address: C },
      { type: 'wallet', walletClientType: 'privy', chainType: 'ethereum', address: '0xabc' },
      { type: 'email', address: 'a@b.co' },
      { type: 'wallet', wallet_client_type: 'privy', chain_type: 'solana', address: A },
      { type: 'wallet', wallet_client_type: 'privy', chain_type: 'solana', address: C },
    ],
  };
  assert.deepEqual(walletsNeedingSigner(user, 'cm1abcdefghijklmnopqrstu'), [A, C]);
});

test('walletsNeedingSigner does nothing without a signer id', () => {
  const user = { linkedAccounts: [{ type: 'wallet', walletClientType: 'privy', chainType: 'solana', address: A }] };
  assert.deepEqual(walletsNeedingSigner(user, ''), []);
  assert.deepEqual(walletsNeedingSigner(null, 'cm1abcdefghijklmnopqrstu'), []);
});
