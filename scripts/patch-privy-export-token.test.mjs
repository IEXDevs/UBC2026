import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { patchPrivyExportAccessToken } from './patch-privy-export-token.mjs';

const ESM = 'node_modules/@privy-io/react-auth/dist/esm/EmbeddedWalletKeyExportScreen-CNWacpBt.mjs';
const CJS = 'node_modules/@privy-io/react-auth/dist/cjs/EmbeddedWalletKeyExportScreen-DVgT7zi4.js';
const SESSION_ESM = 'node_modules/@privy-io/react-auth/dist/esm/use-sign-transaction-internal-Cx-lKGKG.mjs';
const SESSION_CJS = 'node_modules/@privy-io/react-auth/dist/cjs/use-sign-transaction-internal-DbS_YZ_u.js';

const IDENTITY = 'updateUserAndIdToken().then(()=>';

/**
 * Achieves: the export iframe receives the identity token, and a second pass is a no-op.
 * Fails when: the hash still carries getAccessToken() or the session token.
 * Oracle: both bundles call updateUserAndIdToken, and the session client stores maelstromIdentityToken.
 * Side effects / state checked: reads the installed Privy bundle; does not write it.
 * Gaps: does not call auth.privy.io.
 */
test('wallet export sends the identity token to the key screen', () => {
  for (const file of [ESM, CJS]) {
    const patched = patchPrivyExportAccessToken(readFileSync(file, 'utf8'));
    assert.equal(patched, patchPrivyExportAccessToken(patched));
    assert.match(patched, /updateUserAndIdToken\(\)\.then\(\(\)=>\w+\.maelstromIdentityToken\|\|\w+\.getCustomerAccessToken\(\)\)/);
    assert.equal(patched.includes('getAccessTokenInternal'), false);
    assert.equal(patched.includes('y.getAccessToken().then(r)'), false);
    assert.equal(patched.includes('u.getAccessToken().then(i)'), false);
  }
  for (const file of [SESSION_ESM, SESSION_CJS]) {
    const patched = patchPrivyExportAccessToken(readFileSync(file, 'utf8'));
    assert.equal(patched, patchPrivyExportAccessToken(patched));
    assert.match(patched, /this\.maelstromIdentityToken=e\.identity_token/);
  }
});

/**
 * Achieves: the published call and the earlier session-token patch both become the identity-token call.
 * Fails when: an already patched bundle keeps sending getAccessTokenInternal.
 * Oracle: both fixtures contain the identity-token call and not getAccessTokenInternal.
 * Side effects / state checked: none.
 * Gaps: fixtures are the two call shapes, not the whole bundle.
 */
test('identity token patch replaces the published call and the session-token call', () => {
  const published = 'ready;(y.getAccessToken().then(r).catch(j))';
  const previous = 'ready;((y._privyInternal?.getAccessTokenInternal?.()??y.getAccessToken()).then(r).catch(j))';
  for (const source of [published, previous]) {
    const patched = patchPrivyExportAccessToken(source);
    assert.equal(patched, patchPrivyExportAccessToken(patched));
    assert.equal(patched.includes(IDENTITY), true);
    assert.equal(patched.includes('getAccessTokenInternal'), false);
    assert.equal(patched.includes('y.getAccessToken().then(r)'), false);
  }
});
