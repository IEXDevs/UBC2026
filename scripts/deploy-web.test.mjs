import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Achieves: local and Workers Builds web deploys install once and build once.
 * Fails when: a deploy script gains a second npm ci, or prod picks up --env=dev.
 * Oracle: cf:web:build is the only script that runs npm ci; deploy scripts only deploy.
 * Side effects / state checked: source snapshot of package.json and the dev workflow.
 * Gaps: does not run a deploy.
 */
test('root package exposes local web deploy commands for dev and prod', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['deploy:web:dev'], /deploy:dev -w @ubc2026\/web/);
  assert.match(pkg.scripts['deploy:web:prod'], /deploy:prod -w @ubc2026\/web/);
  assert.doesNotMatch(pkg.scripts['deploy:web:dev'], /npm ci/);
  assert.doesNotMatch(pkg.scripts['deploy:web:prod'], /npm ci/);
  assert.equal(pkg.scripts['cf:web:build'], 'npm ci && npm run build:worker -w @ubc2026/web');
  assert.equal((pkg.scripts['cf:web:build'].match(/npm ci/g) || []).length, 1);
  assert.equal(pkg.scripts['cf:web:deploy'], 'npm run deploy:worker -w @ubc2026/web');
  assert.equal(pkg.scripts['cf:web:deploy:dev'], 'npm run deploy:worker:dev -w @ubc2026/web');
  assert.doesNotMatch(pkg.scripts['cf:web:deploy'], /npm ci|build:worker/);
  assert.doesNotMatch(pkg.scripts['cf:web:deploy:dev'], /npm ci|build:worker/);

  const web = JSON.parse(readFileSync(join(root, 'apps/web/package.json'), 'utf8'));
  assert.equal(web.scripts['build:worker'], 'opennextjs-cloudflare build');
  assert.equal(web.scripts['deploy:worker'], 'opennextjs-cloudflare deploy');
  assert.equal(web.scripts['deploy:worker:dev'], 'opennextjs-cloudflare deploy -- --env=dev');
  assert.equal(web.scripts['deploy:dev'], 'npm run build:worker && npm run deploy:worker:dev');
  assert.equal(web.scripts['deploy:prod'], 'npm run build:worker && npm run deploy:worker');
  assert.doesNotMatch(web.scripts['deploy:prod'], /--env=dev/);
  assert.doesNotMatch(web.scripts['deploy:dev'], /npm ci/);
  assert.doesNotMatch(web.scripts['deploy:prod'], /npm ci/);

  const workflow = readFileSync(join(root, '.github/workflows/dev-page.yml'), 'utf8');
  assert.equal((workflow.match(/npm ci/g) || []).length, 1);
  assert.match(workflow, /npm run deploy:web:dev/);
  assert.doesNotMatch(workflow, /npx opennextjs-cloudflare build/);
});
