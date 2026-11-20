import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  accessTokenFromRequest,
  hasServerSessionCookie,
  readPrivyTokenCookie,
} from './privy-cookie-session.mjs';

const JWT = 'header.payload.signature';

/**
 * Achieves: verifies the page-readable marker is not a session token.
 * Fails when: privy-token=t or a non-JWT is returned as an access token.
 * Oracle: readPrivyTokenCookie('privy-token=t') is '' and a three-part JWT is returned.
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('the page-readable marker is not a session token', () => {
  assert.equal(readPrivyTokenCookie('privy-token=t'), '');
  assert.equal(readPrivyTokenCookie('theme=dark; privy-token=t'), '');
  assert.equal(readPrivyTokenCookie(`privy-session=1; privy-token=${JWT}`), JWT);
  assert.equal(hasServerSessionCookie('privy-session=1'), true);
  assert.equal(hasServerSessionCookie('privy-token=t'), false);
  assert.equal(hasServerSessionCookie(''), false);
});

/**
 * Achieves: verifies a request uses the HttpOnly cookie when no bearer is present.
 * Fails when: a bearer is ignored, or the marker cookie becomes the bearer.
 * Oracle: bearer wins; cookie JWT is used when the header is empty; marker yields ''.
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('a request uses the HttpOnly cookie when no bearer is present', () => {
  const headers = (map) => ({ get: (name) => map[name] ?? null });
  assert.equal(accessTokenFromRequest({ headers: headers({ authorization: `Bearer ${JWT}`, cookie: 'privy-token=other.other.other' }) }), JWT);
  assert.equal(accessTokenFromRequest({ headers: headers({ cookie: `privy-token=${JWT}` }) }), JWT);
  assert.equal(accessTokenFromRequest({ headers: headers({ cookie: 'privy-token=t' }) }), '');
});

/**
 * Achieves: verifies spend and login routes accept the HttpOnly session cookie.
 * Fails when: a route still reads only the Authorization header.
 * Oracle: each listed file imports accessTokenFromRequest.
 * Side effects / state checked: source-text snapshot.
 * Gaps: does not perform a live Privy login.
 */
test('spend and login routes accept the HttpOnly session cookie', () => {
  const root = dirname(fileURLToPath(import.meta.url));
  const files = [
    '../app/api/wallets/route.js',
    '../app/api/wallets/move/route.js',
    '../app/api/wallets/retire/route.js',
    '../app/api/portfolio/route.js',
    '../app/api/sns/send/route.js',
    '../app/api/bots/[botId]/chat/route.js',
    '../app/api/files/route.js',
    '../app/api/files/[secret]/route.js',
    '../app/api/runtime/[...path]/route.js',
    './connected-deposit.mjs',
    './solana-balance-read.mjs',
  ];
  for (const file of files) {
    const source = readFileSync(join(root, file), 'utf8');
    assert.match(source, /accessTokenFromRequest|readPrivyTokenCookie/);
  }
});
