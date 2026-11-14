import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findEnvRoot, parseEnvFile, readRootEnv } from './root-env.mjs';

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
