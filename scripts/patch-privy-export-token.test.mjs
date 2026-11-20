import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { patchPrivyExportAccessToken } from './patch-privy-export-token.mjs';

const ESM = 'node_modules/@privy-io/react-auth/dist/esm/EmbeddedWalletKeyExportScreen-CNWacpBt.mjs';
const CJS = 'node_modules/@privy-io/react-auth/dist/cjs/EmbeddedWalletKeyExportScreen-DVgT7zi4.js';

/**
 * Achieves: the export iframe asks for the Privy session token, then the customer token.
 * Fails when: getAccessToken() is still the only token sent to /v1/wallets/authenticate.
 * Oracle: both bundles call getAccessTokenInternal before getAccessToken, and a second pass is a no-op.
 * Side effects / state checked: reads the installed Privy bundle; does not write it.
 * Gaps: does not call auth.privy.io.
 */
test('wallet export uses the Privy session token before the customer token', () => {
  for (const file of [ESM, CJS]) {
    const patched = patchPrivyExportAccessToken(readFileSync(file, 'utf8'));
    assert.equal(patched, patchPrivyExportAccessToken(patched));
    assert.match(patched, /_privyInternal\?\.getAccessTokenInternal\?\.\(\)\?\?/);
    assert.match(patched, /getAccessTokenInternal\?\.\(\)\?\?\w+\.getAccessToken\(\)/);
    assert.equal(patched.includes('y.getAccessToken().then(r)'), false);
    assert.equal(patched.includes('u.getAccessToken().then(i)'), false);
  }
});
