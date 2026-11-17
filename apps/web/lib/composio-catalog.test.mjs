/**
 * Unit tests for Composio connector catalog helpers.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPOSIO_APPS, composioConnectors, composioLogo } from './composio-catalog.mjs';

/**
 * Rigor audit — COMPOSIO_APPS catalog shape
 * Achieves: frozen non-empty catalog with unique ids, required fields, and popular flags.
 * Fails when: duplicate ids, missing name/detail/category, or catalog emptied.
 * Oracle: plugins sheet lists these toolkit slugs with logos.composio.dev URLs.
 * Side effects: none.
 * Gaps: does not verify remote logo HTTP 200 for each slug.
 */
test('COMPOSIO_APPS is a frozen catalog with unique ids and required fields', () => {
  assert.ok(Object.isFrozen(COMPOSIO_APPS));
  assert.ok(COMPOSIO_APPS.length >= 10);
  const ids = new Set();
  for (const app of COMPOSIO_APPS) {
    assert.equal(typeof app.id, 'string');
    assert.ok(app.id.length > 0);
    assert.equal(typeof app.name, 'string');
    assert.equal(typeof app.detail, 'string');
    assert.equal(typeof app.category, 'string');
    assert.equal(ids.has(app.id), false);
    ids.add(app.id);
  }
  assert.ok(COMPOSIO_APPS.some(app => app.popular === true));
  assert.ok(COMPOSIO_APPS.some(app => app.id === 'github'));
  assert.ok(COMPOSIO_APPS.some(app => app.id === 'gmail'));
});

/**
 * Rigor audit — composioLogo / composioConnectors mapping
 * Achieves: logo URLs stay on logos.composio.dev; connectors expose linked:false and
 *   composio:true without inventing builtin links.
 * Fails when: logo host drifts or connectors mark apps linked/builtin by default.
 * Oracle: shell connectors pane treats Composio rows as unlinked until OAuth.
 * Side effects: none.
 * Gaps: none for pure mapping.
 */
test('composioConnectors maps catalog rows to unlinked connector cards', () => {
  assert.equal(composioLogo('github'), 'https://logos.composio.dev/api/github');
  const connectors = composioConnectors();
  assert.equal(connectors.length, COMPOSIO_APPS.length);
  const github = connectors.find(row => row.id === 'github');
  assert.ok(github);
  assert.equal(github.linked, false);
  assert.equal(github.builtin, false);
  assert.equal(github.composio, true);
  assert.equal(github.logo, 'https://logos.composio.dev/api/github');
  assert.equal(github.popular, true);
  for (const row of connectors) {
    assert.equal(row.linked, false);
    assert.equal(row.composio, true);
    assert.match(row.logo, /^https:\/\/logos\.composio\.dev\/api\//);
  }
});
