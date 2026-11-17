import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDemoShellState } from './demo-state.mjs';
import { composioConnectors } from './composio-catalog.mjs';
import { PLUGIN_CHIPS, groupConnectors, pluginCatalog, withSharedLinks } from './connectors.mjs';

const composio = composioConnectors();
const covered = new Set(PLUGIN_CHIPS.flatMap(chip => chip.categories ?? []));

/*
 * Achieves: verifies connectors are owner-shared (no botId), builtins linked, and groupConnectors search splits linked/available.
 * Fails when: bot-scoped connectors appear, github link does not apply, or git search misses gitlab/github split.
 * Oracle: withSharedLinks(['github']); idle available = popular composio minus github; query 'git' → gitlab available, github linked.
 * Side effects / state checked: demo shell connectors + pure grouping.
 * Gaps: no live Composio OAuth link state.
 */
test('connectors stay one shared set and group like a catalog', () => {
  const state = getDemoShellState();
  assert.ok(state.connectors.every(item => item.botId == null));
  assert.ok(state.connectors.filter(item => item.builtin).every(item => item.linked));
  const rows = withSharedLinks(state.connectors, ['github']);
  assert.equal(rows.find(item => item.id === 'github').linked, true);
  assert.equal(rows.find(item => item.id === 'slack').linked, false);
  const idle = groupConnectors(rows, '');
  assert.ok(idle.linked.some(item => item.id === 'solana'));
  assert.ok(idle.linked.some(item => item.id === 'github'));
  assert.deepEqual(
    idle.available.map(item => item.id),
    composio.filter(item => item.popular && item.id !== 'github').map(item => item.id),
  );
  const found = groupConnectors(rows, 'git');
  assert.deepEqual(found.available.map(item => item.id), ['gitlab']);
  assert.deepEqual(found.linked.map(item => item.id), ['github']);
});

/*
 * Achieves: verifies pluginCatalog section order, recommended expand, chip/query filters, and custom provider lead section.
 * Fails when: Recommended ≠ first 8, expand shows all, Chain/Research/Identity/Payments order drifts, or custom providers lose lead.
 * Oracle: titles Recommended → Chain/Research/Identity/Payments; chip code; query sol→solana; connectedOnly all linked.
 * Side effects / state checked: N/A.
 * Gaps: UI expand click not executed — helper options only.
 */
test('plugin catalog leads with Composio apps, then built-in sections', () => {
  const rows = withSharedLinks(getDemoShellState().connectors, []);
  const sections = pluginCatalog(rows);
  assert.equal(sections[0].title, 'Recommended for you');
  assert.deepEqual(sections[0].items.map(item => item.id), composio.slice(0, 8).map(item => item.id));
  assert.equal(sections[0].canExpand, true);
  const open = pluginCatalog(rows, { showAllRecommended: true });
  assert.deepEqual(open[0].items.map(item => item.id), composio.map(item => item.id));
  assert.equal(open[0].canExpand, false);
  assert.deepEqual(
    sections.filter(section => section.id !== 'recommended').map(section => section.title),
    ['Chain', 'Research', 'Identity', 'Payments'],
  );
  assert.deepEqual(
    pluginCatalog(rows, { chip: 'code' })[0].items.map(item => item.id),
    composio.filter(item => item.category === 'Code').map(item => item.id),
  );
  assert.deepEqual(pluginCatalog(rows, { query: 'sol' })[0].items.map(item => item.id), ['solana']);
  assert.equal(pluginCatalog(rows, { query: 'nope' }).length, 0);
  assert.ok(pluginCatalog(rows, { connectedOnly: true }).every(section => section.items.every(item => item.linked)));
  const withCustom = pluginCatalog([
    ...rows,
    { id: 'provider_acme', name: 'Acme', detail: 'Token ••••91af', category: 'Custom', custom: true, linked: true },
  ]);
  assert.equal(withCustom[0].title, 'Your providers');
  assert.deepEqual(withCustom[0].items.map(item => item.id), ['provider_acme']);
  assert.equal(withCustom[1].title, 'Recommended for you');
});

/*
 * Achieves: verifies every Composio app has logo URL, category chip coverage, unique ids, and firecrawl uses logos CDN.
 * Fails when: catalog < 24, logo path drifts, category missing from PLUGIN_CHIPS, or duplicate ids.
 * Oracle: logo https://logos.composio.dev/api/{id}; composio true builtin false; unique ids.
 * Side effects / state checked: composioConnectors() + demo firecrawl logo.
 * Gaps: does not HTTP-check logo URLs resolve.
 */
test('every Composio app has a logo and a category chip', () => {
  assert.ok(composio.length >= 24);
  for (const app of composio) {
    assert.equal(app.composio, true);
    assert.equal(app.builtin, false);
    assert.equal(app.logo, `https://logos.composio.dev/api/${app.id}`);
    assert.ok(covered.has(app.category), app.category);
  }
  const ids = composio.map(app => app.id);
  assert.equal(new Set(ids).size, ids.length);
  const firecrawl = getDemoShellState().connectors.find(item => item.id === 'firecrawl');
  assert.equal(firecrawl.logo, 'https://logos.composio.dev/api/firecrawl');
});
