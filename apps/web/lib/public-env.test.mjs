import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicEnv, publicPrivyIds } from './public-env.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('public Privy ids are trimmed and stay empty when unset', () => {
  assert.equal(publicEnv('NEXT_PUBLIC_PRIVY_APP_ID', { NEXT_PUBLIC_PRIVY_APP_ID: '  app_1  ' }), 'app_1');
  assert.equal(publicEnv('NEXT_PUBLIC_PRIVY_APP_ID', { NEXT_PUBLIC_PRIVY_APP_ID: '   ' }), '');
  assert.equal(publicEnv('NEXT_PUBLIC_PRIVY_APP_ID', {}), '');
  assert.deepEqual(publicPrivyIds({
    NEXT_PUBLIC_PRIVY_APP_ID: ' app_1 ',
    NEXT_PUBLIC_PRIVY_CLIENT_ID: '',
  }), { appId: 'app_1', clientId: '' });
});

test('the logged-out landing reads Privy ids from the server layout', () => {
  const layout = readFileSync(join(root, 'app/layout.js'), 'utf8');
  const page = readFileSync(join(root, 'app/page.js'), 'utf8');
  const rootClient = readFileSync(join(root, 'components/PrivyRoot.js'), 'utf8');
  assert.match(layout, /publicPrivyIds\(\)/);
  assert.match(layout, /appId=\{privy\.appId\}/);
  assert.match(layout, /clientId=\{privy\.clientId\}/);
  assert.doesNotMatch(page, /process\.env\.NEXT_PUBLIC_PRIVY_APP_ID/);
  assert.doesNotMatch(rootClient, /process\.env\.NEXT_PUBLIC_PRIVY_APP_ID/);
  assert.match(page, /usePrivyPublic/);
  assert.match(page, /SignInPage/);
});
