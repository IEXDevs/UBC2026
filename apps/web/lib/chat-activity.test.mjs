import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizeActivity, thinkStep, toolStep } from './chat-activity.mjs';

test('a web search keeps the query and public sites', () => {
  const step = toolStep('web_search', { query: 'USDC rates' }, {
    results: [
      { title: 'Circle', url: 'https://www.circle.com/usdc' },
      { title: 'skip', url: 'javascript:alert(1)' },
      { url: 'https://live.browser.run/ui/view?token=secret' },
    ],
  });
  assert.equal(step.kind, 'search');
  assert.equal(step.query, 'USDC rates');
  assert.deepEqual(step.sites, [{ title: 'Circle', url: 'https://www.circle.com/usdc', host: 'circle.com' }]);
});

test('a scraped page becomes one site and a failed tool stays empty', () => {
  const page = toolStep('web_scrape', { url: 'https://example.com/rates' }, {
    page: { url: 'https://example.com/rates', title: 'Rates' },
  });
  assert.equal(page.kind, 'page');
  assert.equal(page.host, 'example.com');
  const failed = toolStep('get_price', { mint: 'EPjF' }, '{"error":"tool_failed"}');
  assert.equal(failed.status, 'error');
  assert.equal(failed.detail, 'EPjF');
});

test('stored activity drops private urls and blank thoughts', () => {
  assert.equal(thinkStep('   '), null);
  const steps = sanitizeActivity([
    { kind: 'think', text: 'Checked the rate.' },
    { kind: 'search', query: 'USDC', sites: [{ title: 'Nope', url: 'https://live.browser.run/secret', host: 'live.browser.run' }] },
    { kind: 'tool', label: 'Checked a price', name: 'get_price', detail: 'USDC', status: 'done' },
  ]);
  assert.equal(steps[0].text, 'Checked the rate.');
  assert.deepEqual(steps[1].sites, []);
  assert.equal(steps[2].label, 'Checked a price');
});

test('repeated searches and a bare search query stay out of the log', () => {
  const noisy = toolStep('web_search', { query: 'search' }, { results: [] });
  assert.equal(noisy.query, '');
  assert.equal(toolStep('browser_open', { url: 'https://x.com' }, { error: 'repeated_tool' }), null);
  const blocked = toolStep('browser_navigate', { url: 'https://x.com' }, { error: 'site_blocked', host: 'x.com' });
  assert.equal(blocked.label, 'Skipped a blocked site');
  const steps = sanitizeActivity([
    { kind: 'search', query: 'USDC', sites: [], status: 'done' },
    { kind: 'search', query: 'USDC', sites: [], status: 'done' },
  ]);
  assert.equal(steps.length, 1);
});
