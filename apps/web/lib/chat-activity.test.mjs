import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publicApiSummary, sanitizeActivity, spendFailureMessage, thinkStep, toolStep } from './chat-activity.mjs';

/**
 * Achieves: verifies web search keeps public sites and drops javascript / live.browser.run secrets.
 * Fails when: Circle URL dropped, javascript kept, or live.browser.run token URL appears in sites.
 * Oracle: sites = [{ title:Circle, url:circle.com/... }]; kind search; query preserved.
 * Side effects / state checked: N/A.
 * Gaps: none for search sanitization.
 */
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

/**
 * Achieves: verifies scrape becomes a page step and failed tools surface error status with detail.
 * Fails when: page kind/host wrong, or tool_failed JSON is treated as success.
 * Oracle: web_scrape → kind page host example.com; get_price error string → status error detail EPjF.
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('a scraped page becomes one site and a failed tool stays empty', () => {
  const page = toolStep('web_scrape', { url: 'https://example.com/rates' }, {
    page: { url: 'https://example.com/rates', title: 'Rates' },
  });
  assert.equal(page.kind, 'page');
  assert.equal(page.host, 'example.com');
  const failed = toolStep('get_price', { mint: 'EPjF' }, '{"error":"tool_failed","hint":"The price feed refused the mint."}');
  assert.equal(failed.status, 'error');
  assert.equal(failed.detail, 'EPjF');
  assert.equal(failed.command, 'get_price mint=EPjF');
  assert.match(failed.error, /tool_failed/);
  assert.match(failed.error, /price feed refused/);
  const search = toolStep('web_search', { query: 'USDC rates' }, { error: 'tool_failed' });
  assert.equal(search.status, 'error');
  assert.equal(search.command, 'web_search query=USDC rates');
  const kept = sanitizeActivity([failed, search]);
  assert.equal(kept[0].command, 'get_price mint=EPjF');
  assert.match(kept[1].error, /tool_failed/);
});

test('spend approval activity shows the reason for the hold', () => {
  const cases = [
    ['per-transaction', /per-transfer limit/],
    ['total-outflow', /remaining spending budget/],
    [null, /without an accepted confirmation/],
  ];
  for (const [reason, expected] of cases) {
    const spend = toolStep('request_spend', { asset: 'SOL' }, {
      error: 'approval-needed', reason, signed: false,
    });
    const [kept] = sanitizeActivity([spend]);
    assert.match(kept.error, /approval-needed/);
    assert.match(kept.error, expected);
  }
});

test('spend blocks use known explanations without displaying raw error details', () => {
  const known = toolStep('request_spend', { asset: 'SOL' }, {
    ok: false, state: 'blocked', reason: 'approval-save-failed',
  });
  assert.equal(known.status, 'error');
  assert.match(known.error, /^blocked\nThe spend service could not save the approval\./);

  const unknown = toolStep('request_spend', { asset: 'SOL' }, {
    error: 'blocked', reason: 'raw provider diagnostics',
  });
  assert.match(unknown.error, /without a recognized reason/);
  assert.doesNotMatch(unknown.error, /raw provider diagnostics/);
});

/**
 * Achieves: verifies sanitizeActivity drops private URLs and blank thoughts.
 * Fails when: blank think kept, live.browser.run site survives, or tool label lost.
 * Oracle: thinkStep('   ')→null; search sites cleared; tool label preserved.
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
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

/**
 * Achieves: verifies every API/MCP call stays in the useful log with its command and return.
 * Fails when: bare query 'search' kept, repeated_tool dropped, or duplicate searches not collapsed.
 * Oracle: query 'search'→''; repeated_tool visible with command+output; every browser call kept; duplicate USDC searches → length 1.
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('a Laso API result stays visible and drops payment secrets', () => {
  const quote = toolStep('prepare_shopping', { provider: 'laso' }, {
    provider: 'laso',
    amountUsd: 5,
    next: 'await-owner-mainnet-approval',
    proposal: { outflow: '5000000', recipient: '3MZVk97x9SeRxbYpc3jhzRfU2fyA3emYutnqfn9kNfYX' },
    challenge: { accepted: { payTo: '3MZVk97x9SeRxbYpc3jhzRfU2fyA3emYutnqfn9kNfYX' } },
    claimUrl: 'https://laso.finance/claim/card-1',
    paymentRequired: 'eyJhbGciOiJub25lIn0.secret.secret',
  });
  assert.equal(quote.label, 'Laso API');
  assert.match(quote.output, /https:\/\/laso\.finance\/claim\/card-1/);
  assert.equal(quote.output.includes('eyJ'), false);
  const [kept] = sanitizeActivity([quote]);
  assert.match(kept.output, /claim\/card-1/);
  assert.equal(publicApiSummary('request_spend', {
    error: 'simulation_failed',
    signed: false,
  }).includes('did not simulate'), true);
  const wallet = 'So11111111111111111111111111111111111111112';
  const hint = `Payment checked agent wallet ${wallet} for a USDC account that covers this amount. Nothing was submitted.`;
  assert.equal(spendFailureMessage({ error: 'simulation_failed', simulationReason: 'source_account_not_found', hint }), hint);
  assert.equal(spendFailureMessage({ error: 'simulation_failed', simulationReason: 'instruction_2_custom_1' }), 'The agent wallet does not have enough USDC for this card. Nothing was submitted.');
  assert.equal(publicApiSummary('request_spend', { signature: 'sig', signed: true }), '');
});

test('repeated searches and a bare search query stay out of the log', () => {
  const noisy = toolStep('web_search', { query: 'search' }, { results: [] });
  assert.equal(noisy.query, '');
  const repeated = toolStep('browser_open', { url: 'https://x.com' }, { error: 'repeated_tool' });
  assert.equal(repeated.status, 'error');
  assert.match(repeated.command, /browser_open/);
  assert.match(repeated.output, /repeated_tool/);
  const retried = toolStep('browser_open', { url: 'https://www.apple.com/iphone/' }, { ok: true });
  assert.equal(retried.status, 'done');
  assert.match(retried.command, /apple\.com/);
  const navigated = toolStep('browser_navigate', { url: 'https://x.com' }, { ok: true, url: 'https://x.com' });
  assert.equal(navigated.status, 'done');
  assert.match(navigated.command, /x\.com/);
  const steps = sanitizeActivity([
    { kind: 'search', query: 'USDC', sites: [], status: 'done' },
    { kind: 'search', query: 'USDC', sites: [], status: 'done' },
  ]);
  assert.equal(steps.length, 1);
});
