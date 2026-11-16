import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonc } from './jsonc.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('OpenNext wrangler config targets Cloudflare', () => {
  const wrangler = parseJsonc(readFileSync(join(root, 'wrangler.jsonc'), 'utf8'));
  assert.equal(wrangler.name, 'maelstrom-web');
  assert.equal(wrangler.main, '.open-next/worker.js');
  assert.equal(wrangler.assets.directory, '.open-next/assets');
  assert.equal(wrangler.assets.binding, 'ASSETS');
  assert.ok(wrangler.compatibility_flags.includes('nodejs_compat'));
  assert.equal(wrangler.services[0].binding, 'WORKER_SELF_REFERENCE');
  assert.equal(wrangler.services[0].service, wrangler.name);
  assert.equal(wrangler.services[1].binding, 'AGENT_RUNTIME');
  assert.equal(wrangler.services[1].service, 'maelstrom-agent-runtime');
  assert.equal(wrangler.env.dev.services[1].binding, 'AGENT_RUNTIME');
  assert.equal(wrangler.env.dev.services[1].service, 'maelstrom-agent-runtime');
  assert.equal(wrangler.vars, undefined);

  const openNext = readFileSync(join(root, 'open-next.config.ts'), 'utf8');
  assert.match(openNext, /defineCloudflareConfig/);

  const headers = readFileSync(join(root, 'public/_headers'), 'utf8');
  assert.match(headers, /\/_next\/static\/\*/);
  assert.match(headers, /Cache-Control: public,max-age=31536000,immutable/);

  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.build, /next build/);
  assert.match(pkg.scripts.preview, /opennextjs-cloudflare build && opennextjs-cloudflare preview/);
  assert.match(pkg.scripts.deploy, /opennextjs-cloudflare build && opennextjs-cloudflare deploy/);
  assert.ok(pkg.dependencies['@opennextjs/cloudflare']);
  assert.ok(pkg.dependencies['@privy-io/react-auth']);
});
