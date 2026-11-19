import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonc } from './jsonc.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Achieves: verifies OpenNext Cloudflare wrangler/assets/services and deploy script contracts.
 * Fails when: worker name/main/assets drift, AGENT_RUNTIME service unbound, or deploy scripts lose opennextjs-cloudflare.
 * Oracle: wrangler.name maelstrom-web; main .open-next/worker.js; services include AGENT_RUNTIME→maelstrom-agent-runtime; no vars secrets in wrangler.
 * Side effects / state checked: reads wrangler.jsonc, open-next.config.ts, _headers, package.json.
 * Gaps: source/config snapshot only — does not deploy or boot Workers.
 */
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
  assert.equal(wrangler.cache?.enabled, true);
  assert.equal(wrangler.env.dev.cache?.enabled, true);

  const openNext = readFileSync(join(root, 'open-next.config.ts'), 'utf8');
  assert.match(openNext, /defineCloudflareConfig/);

  const headers = readFileSync(join(root, 'public/_headers'), 'utf8');
  assert.match(headers, /\/_next\/static\/\*/);
  assert.match(headers, /Cache-Control: public,max-age=31536000,immutable/);
  assert.match(headers, /\/api\/build/);
  assert.doesNotMatch(headers, /Cache-Control:\s*no-cache/);

  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.build, /next build/);
  assert.equal(pkg.scripts['build:worker'], 'opennextjs-cloudflare build');
  assert.match(pkg.scripts.preview, /npm run build:worker && opennextjs-cloudflare preview/);
  assert.equal(pkg.scripts['deploy:prod'], 'npm run build:worker && npm run deploy:worker');
  assert.match(pkg.scripts.deploy, /deploy:prod/);
  assert.equal(pkg.scripts['deploy:dev'], 'npm run build:worker && npm run deploy:worker:dev');
  assert.match(pkg.scripts['deploy:worker:dev'], /--env=dev/);
  assert.equal(wrangler.env.dev.name, 'maelstrom-web-dev');
  assert.equal(wrangler.env.dev.routes[0].pattern, 'dev.maelstrom.iexdevs.com');
  assert.equal(wrangler.env.dev.routes[0].custom_domain, true);
  assert.ok(pkg.dependencies['@opennextjs/cloudflare']);
  assert.ok(pkg.dependencies['@privy-io/react-auth']);
});
