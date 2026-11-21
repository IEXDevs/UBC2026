/**
 * Next POST/GET /api/wallets helper tests.
 * Oracles: Privy Origin rules + public wallet JSON contract.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WalletError } from '@ubc2026/wallets';
import {
  filterArchivedWallets,
  needsArchivedReissue,
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

/**
 * Rigor audit — Origin selection for Privy acceptLogin
 * Achieves: sanitized Origin > Referer origin > localhost default; junk Origin
 *   never forwarded; credentials/CRLF fall back safely.
 * Fails when: injection strings become Privy Origin or Referer is ignored when
 *   Origin is junk.
 * Oracle: sanitizeOrigin + URL(referer).origin; default http://localhost:3000.
 * Side effects: none (pure).
 * Gaps: none for selection order. Remaining: does not exercise the route handler
 *   wiring (source contract in next-api-routes.test.mjs).
 */
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
  assert.equal(
    requestOrigin(req({ origin: 'https://ok.example\r\nX-Evil: 1' })),
    'http://localhost:3000',
  );
  assert.equal(
    requestOrigin(req({ origin: 'https://user:pass@evil.example' })),
    'http://localhost:3000',
  );
  assert.equal(
    requestOrigin(req({
      origin: 'javascript:alert(1)',
      referer: 'http://localhost:3000/app',
    })),
    'http://localhost:3000',
  );
  // Bad referer must not throw; fall through to localhost.
  assert.equal(
    requestOrigin(req({ referer: 'not-a-url' })),
    'http://localhost:3000',
  );
});

/**
 * Rigor audit — public wallet JSON shape
 * Achieves: linked_* ids are never spendable even if spendable:true was set;
 *   response keys are a fixed allowlist (no auth key leakage).
 * Fails when: linked wallets can sign/spend or extra secret fields appear.
 * Oracle: shell/runtime contract — observing wallets are non-spendable.
 * Side effects: none.
 * Gaps: none — closed: spendable:false on main; frozen does not change spendable alone.
 */
test('publicWallet marks linked_ ids non-spendable even if spendable was true', () => {
  const linked = publicWallet({
    id: 'linked_abc',
    ownerId: 'did:privy:u1',
    kind: 'additional',
    label: 'Phantom',
    address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    frozen: false,
    provider: 'privy',
    spendable: true,
    walletClientType: 'phantom',
    authorizationKey: 'wallet-auth:leak',
  });
  assert.equal(linked.spendable, false);
  assert.equal(linked.walletClientType, 'phantom');
  assert.equal(Object.prototype.hasOwnProperty.call(linked, 'authorizationKey'), false);

  const main = publicWallet({
    id: 'w_main',
    ownerId: 'did:privy:u1',
    kind: 'main',
    label: 'Main',
    address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    frozen: false,
    provider: 'privy',
  });
  assert.equal(main.spendable, true);
  assert.equal(main.walletClientType, null);
  assert.deepEqual(Object.keys(main).sort(), [
    'address', 'frozen', 'id', 'kind', 'label', 'ownerId', 'provider', 'spendable', 'walletClientType',
  ].sort());

  const frozenMain = publicWallet({
    id: 'w_main',
    ownerId: 'did:privy:u1',
    kind: 'main',
    label: 'Main',
    address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    frozen: true,
    provider: 'privy',
    spendable: false,
  });
  assert.equal(frozenMain.spendable, false);
  assert.equal(frozenMain.frozen, true);
});

/**
 * Rigor audit — WalletError → HTTP fields
 * Achieves: only WalletError-shaped objects produce codes; CR/LF stripped from
 *   detail; invalid codes become wallet_failed; status mapping 503 vs 502.
 * Fails when: plain Errors are treated as WalletError, newlines leak into JSON,
 *   or missing_origin returns 502 instead of 503.
 * Oracle: route contract — config/origin → 503; Privy failures → 502.
 * Side effects: none.
 * Gaps: none for field sanitization. Remaining: full POST route still needs
 *   integration (login_required covered in next-api-routes.test.mjs).
 */
test('walletErrorFields only accepts WalletError-shaped objects and sanitizes detail', () => {
  assert.equal(walletErrorFields(null), null);
  assert.equal(walletErrorFields(new Error('plain')), null);
  assert.equal(walletErrorFields({ name: 'TypeError', code: 'privy_failed', message: 'x' }), null);

  const err = new WalletError('line1\nline2\rsecret', 'privy_failed');
  const fields = walletErrorFields(err);
  assert.equal(fields.code, 'privy_failed');
  assert.equal(fields.detail.includes('\n'), false);
  assert.equal(fields.detail.includes('\r'), false);
  assert.ok(fields.detail.length <= 180);

  const badCode = new WalletError('x', 'PRIVY FAILED!!');
  assert.equal(walletErrorFields(badCode).code, 'wallet_failed');

  // Duck-typed WalletError (duplicated package instanceof failure).
  const duck = { name: 'WalletError', code: 'missing_origin', message: 'need origin' };
  assert.deepEqual(walletErrorFields(duck), { code: 'missing_origin', detail: 'need origin' });

  assert.equal(walletErrorStatus('missing_origin'), 503);
  assert.equal(walletErrorStatus('missing_config'), 503);
  assert.equal(walletErrorStatus('invalid_rpc'), 503);
  assert.equal(walletErrorStatus('privy_failed'), 502);
  assert.equal(walletErrorStatus('wallet_failed'), 502);
});

/**
 * Rigor audit — archived wallets stay archived across devices
 * Achieves: soft-deleted ids are filtered from the login response; invalid
 *   rows are dropped; reissue triggers only when everything is archived.
 * Fails when: a new device resurrects an archived wallet, or a desk with a
 *   live wallet issues a spare on every login.
 * Oracle: wallets.read deleted_at is the archive bit; login must honor it.
 * Side effects: none (pure).
 * Gaps: the Supabase read itself is covered by route wiring, not here.
 */
test('login filters soft-deleted wallets and reissues only when all are archived', () => {
  const main = {
    id: 'w_main', ownerId: 'did:privy:u1', kind: 'main', label: 'Main',
    address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    frozen: false, provider: 'privy', spendable: true,
  };
  const extra = {
    id: 'w_shop', ownerId: 'did:privy:u1', kind: 'additional', label: 'Shop',
    address: 'So11111111111111111111111111111111111111112',
    frozen: false, provider: 'privy', spendable: true,
  };
  // One archived, one live: live survives, no reissue.
  const partial = filterArchivedWallets([main, extra, null], new Set(['w_shop']));
  assert.deepEqual(partial.map(wallet => wallet.id), ['w_main']);
  assert.equal(needsArchivedReissue(partial, new Set(['w_shop'])), false);
  // Nothing archived: everything passes through, no reissue.
  const fresh = filterArchivedWallets([main, extra], new Set());
  assert.deepEqual(fresh.map(wallet => wallet.id), ['w_main', 'w_shop']);
  assert.equal(needsArchivedReissue(fresh, new Set()), false);
  // Everything archived: empty list, reissue required.
  const empty = filterArchivedWallets([main, extra], new Set(['w_main', 'w_shop']));
  assert.deepEqual(empty, []);
  assert.equal(needsArchivedReissue(empty, new Set(['w_main', 'w_shop'])), true);
  // Empty Privy response with no archive history: no reissue (fresh signup path).
  assert.equal(needsArchivedReissue([], new Set()), false);
  // Array form also accepted.
  assert.equal(needsArchivedReissue([], ['w_old']), true);
});
