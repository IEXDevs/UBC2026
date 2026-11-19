import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Achieves: root CLI can deploy the web Worker to either env without Cloudflare Builds.
 * Fails when: deploy:web:dev / deploy:web:prod are missing or no longer target @ubc2026/web.
 * Oracle: package.json scripts call workspace deploy:dev and deploy:prod.
 * Side effects / state checked: source snapshot only.
 * Gaps: does not run a deploy.
 */
test('root package exposes local web deploy commands for dev and prod', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['deploy:web:dev'], /deploy:dev -w @ubc2026\/web/);
  assert.match(pkg.scripts['deploy:web:prod'], /deploy:prod -w @ubc2026\/web/);

  const web = JSON.parse(readFileSync(join(root, 'apps/web/package.json'), 'utf8'));
  assert.match(web.scripts['deploy:dev'], /opennextjs-cloudflare build && opennextjs-cloudflare deploy/);
  assert.match(web.scripts['deploy:dev'], /--env=dev/);
  assert.match(web.scripts['deploy:prod'], /opennextjs-cloudflare build && opennextjs-cloudflare deploy/);
  assert.doesNotMatch(web.scripts['deploy:prod'], /--env=dev/);
});
