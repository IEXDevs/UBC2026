import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyRootPublicEnv, findEnvRoot, parseEnvFile, readRootEnv } from './root-env.mjs';

test('root env reads a named value and ignores blanks', () => {
  const env = { ELEVENLABS_API_KEY: '  server-key  ', ELEVENLABS_AGENT_ID: '' };
  assert.equal(readRootEnv('ELEVENLABS_API_KEY', env), 'server-key');
  assert.equal(readRootEnv('ELEVENLABS_AGENT_ID', env), '');
  assert.equal(readRootEnv('MISSING', env), '');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maelstrom-env-'));
  const nested = path.join(root, 'apps', 'web');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ workspaces: ['apps/*'] }));
  fs.writeFileSync(path.join(root, '.env.local'), 'ELEVENLABS_API_KEY=\n');
  fs.writeFileSync(path.join(nested, 'package.json'), JSON.stringify({ name: 'web' }));
  assert.equal(findEnvRoot(nested), root);
  assert.deepEqual(parseEnvFile('# note\nELEVENLABS_API_KEY="server-key"\nSKIP=1'), {
    ELEVENLABS_API_KEY: 'server-key',
    SKIP: '1',
  });
});

test('worker process env overrides the local file', () => {
  const previous = process.env.QUICKNODE_DEVNET_RPC_URL;
  process.env.QUICKNODE_DEVNET_RPC_URL = 'https://example.invalid/devnet';
  try {
    assert.equal(readRootEnv('QUICKNODE_DEVNET_RPC_URL'), 'https://example.invalid/devnet');
  } finally {
    if (previous === undefined) delete process.env.QUICKNODE_DEVNET_RPC_URL;
    else process.env.QUICKNODE_DEVNET_RPC_URL = previous;
  }
});

test('applyRootPublicEnv copies only unset NEXT_PUBLIC_ values', () => {
  const source = {
    NEXT_PUBLIC_PRIVY_APP_ID: ' from-root ',
    NEXT_PUBLIC_PRIVY_CLIENT_ID: '',
    PRIVY_APP_SECRET: 'secret',
    NEXT_PUBLIC_AGENT_RUNTIME_URL: 'https://runtime.example',
  };
  const target = { NEXT_PUBLIC_AGENT_RUNTIME_URL: 'https://already.set' };
  assert.deepEqual(applyRootPublicEnv(target, source), ['NEXT_PUBLIC_PRIVY_APP_ID']);
  assert.equal(target.NEXT_PUBLIC_PRIVY_APP_ID, 'from-root');
  assert.equal(target.NEXT_PUBLIC_AGENT_RUNTIME_URL, 'https://already.set');
  assert.equal(target.PRIVY_APP_SECRET, undefined);
  assert.equal(Object.hasOwn(target, 'NEXT_PUBLIC_PRIVY_CLIENT_ID'), false);
});
