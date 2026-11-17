/**
 * Rigorous tests for Next POST/GET /api/wallets helpers.
 * Oracles come from Privy Origin rules and the public wallet contract,
 * not from re-reading route.js control flow.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WalletError } from '@ubc2026/wallets';
import {
  publicWallet,
  requestOrigin,
  walletErrorFields,
  walletErrorStatus,
} from './wallets-route.mjs';

function req(headers = {}) {
  return {
    headers: {
      get(name) {
        const key = String(name).toLowerCase();
        for (const [k, v] of Object.entries(headers)) {
          if (k.toLowerCase() === key) return v;
        }
        return null;
      },
    },
  };
}

test('requestOrigin prefers sanitized Origin over Referer over localhost default', () => {
  assert.equal(
    requestOrigin(req({ origin: 'https://dev.maelstrom.iexdevs.com' })),
    'https://dev.maelstrom.iexdevs.com',
  );
  assert.equal(
    requestOrigin(req({ referer: 'https://dev.maelstrom.iexdevs.com/desk?x=1' })),
    'https://dev.maelstrom.iexdevs.com',
  );
  assert.equal(requestOrigin(req({})), 'http://localhost:3000');
  // Injection / credentials must not become the Privy Origin.
  assert.equal(
    requestOrigin(req({ origin: 'https://ok.example\r\nX-Evil: 1' })),
    'http://localhost:3000',
  );
  assert.equal(
    requestOrigin(req({ origin: 'https://user:pass@evil.example' })),
    'http://localhost:3000',
  );
  // When Origin is junk, Referer can still supply a safe origin.
  assert.equal(
    requestOrigin(req({
      origin: 'javascript:alert(1)',
      referer: 'http://localhost:3000/app',
    })),
    'http://localhost:3000',
  );
});

test('publicWallet marks linked_ ids non-spendable even if spendable was true', () => {
  const linked = publicWallet({
    id: 'linked_abc',
    ownerId: 'did:privy:u1',
    kind: 'additional',
    label: 'Phantom',
    address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    frozen: false,
    provider: 'privy',
    spendable: true,
    walletClientType: 'phantom',
  });
  assert.equal(linked.spendable, false);
  assert.equal(linked.walletClientType, 'phantom');

  const main = publicWallet({
    id: 'w_main',
    ownerId: 'did:privy:u1',
    kind: 'main',
    label: 'Main',
    address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    frozen: false,
    provider: 'privy',
  });
  assert.equal(main.spendable, true);
  assert.equal(main.walletClientType, null);
  // Must not leak arbitrary internal fields into the JSON response shape.
  assert.equal(Object.prototype.hasOwnProperty.call(main, 'authorizationKey'), false);
  assert.deepEqual(Object.keys(main).sort(), [
    'address', 'frozen', 'id', 'kind', 'label', 'ownerId', 'provider', 'spendable', 'walletClientType',
  ].sort());
});

test('walletErrorFields only accepts WalletError-shaped objects and sanitizes detail', () => {
  assert.equal(walletErrorFields(null), null);
  assert.equal(walletErrorFields(new Error('plain')), null);
  assert.equal(walletErrorFields({ name: 'TypeError', code: 'privy_failed', message: 'x' }), null);

  const err = new WalletError('line1\nline2\rsecret', 'privy_failed');
  const fields = walletErrorFields(err);
  assert.equal(fields.code, 'privy_failed');
  assert.equal(fields.detail.includes('\n'), false);
  assert.equal(fields.detail.includes('\r'), false);

  const badCode = new WalletError('x', 'PRIVY FAILED!!');
  // Invalid codes must not pass through as HTTP error identifiers.
  assert.equal(walletErrorFields(badCode).code, 'wallet_failed');

  assert.equal(walletErrorStatus('missing_origin'), 503);
  assert.equal(walletErrorStatus('missing_config'), 503);
  assert.equal(walletErrorStatus('invalid_rpc'), 503);
  assert.equal(walletErrorStatus('privy_failed'), 502);
  assert.equal(walletErrorStatus('wallet_failed'), 502);
});
