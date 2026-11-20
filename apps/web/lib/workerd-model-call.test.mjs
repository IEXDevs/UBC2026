/**
 * Runs the hosted chat model call and provider model check inside real
 * workerd (Miniflare), with every upstream request answered by a local mock.
 * Node's fetch accepts options workerd rejects (e.g. redirect 'error'), so a
 * Node-only test can pass while every hosted chat turn fails.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';

const here = path.dirname(fileURLToPath(import.meta.url));
const wrangler = JSON.parse((await import('node:fs')).readFileSync(path.join(here, '..', 'wrangler.jsonc'), 'utf8')
  .replace(/^\s*\/\/.*$/gm, ''));

const ENTRY = `
import { completeTextChat } from './text-chat.mjs';
import { checkProviderModels } from './ai-provider.mjs';
export default {
  async fetch(request) {
    const run = new URL(request.url).pathname;
    try {
      if (run === '/account') {
        const reply = await completeTextChat({ metaModelApiKey: 'LLM_synthetic-test-key', message: 'Hello' });
        return Response.json({ ok: true, text: reply.text, provider: reply.provider });
      }
      if (run === '/custom') {
        const reply = await completeTextChat({
          modelProvider: { baseUrl: 'https://api.openai.com/v1', token: 'synthetic-test-key-not-a-credential' },
          model: 'gpt-test-a', message: 'Hello',
        });
        return Response.json({ ok: true, text: reply.text, provider: reply.provider });
      }
      if (run === '/catalog') {
        return Response.json(await checkProviderModels({ baseUrl: 'https://api.openai.com/v1', apiKey: 'synthetic-test-key-not-a-credential' }));
      }
      return new Response('unknown', { status: 404 });
    } catch (error) {
      return Response.json({ ok: false, error: error?.code || error?.name || 'error' });
    }
  },
};
`;

async function startWorker(upstream) {
  const bundle = await build({
    stdin: { contents: ENTRY, resolveDir: here, sourcefile: 'workerd-model-call-entry.mjs', loader: 'js' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    conditions: ['workerd', 'worker', 'browser'],
    mainFields: ['module', 'main'],
    external: ['node:*'],
    logLevel: 'silent',
  });
  return new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: wrangler.compatibility_date,
    compatibilityFlags: wrangler.compatibility_flags,
    outboundService: upstream,
  }));
}

const completion = async request => {
  const body = await request.text();
  return Response.json({ choices: [{ message: { content: body.includes('Role: turn-verify') ? '{"allow":true}' : 'Hello from workerd' } }] });
};

test('hosted chat turns and model checks reach the provider inside workerd', async () => {
  const seen = [];
  const mf = await startWorker(async request => {
    seen.push(new URL(request.url).href);
    if (request.url.endsWith('/models')) return Response.json({ data: [{ id: 'gpt-test-a', name: 'Model A' }] });
    return completion(request);
  });
  try {
    for (const [run, provider] of [['account', 'meta'], ['custom', 'openai']]) {
      const reply = await (await mf.dispatchFetch(`http://worker.test/${run}`)).json();
      assert.deepEqual(reply, { ok: true, text: 'Hello from workerd', provider }, `${run} chat turn`);
    }
    const catalog = await (await mf.dispatchFetch('http://worker.test/catalog')).json();
    assert.equal(catalog.ok, true, `catalog check: ${catalog.error}`);
    assert.ok(seen.includes('https://api.meta.ai/v1/chat/completions'));
    assert.ok(seen.includes('https://api.openai.com/v1/chat/completions'));
  } finally {
    await mf.dispose();
  }
});

test('a provider redirect is not followed inside workerd', async () => {
  const seen = [];
  const mf = await startWorker(async request => {
    seen.push(new URL(request.url).host);
    return new Response(null, { status: 302, headers: { Location: 'https://redirect.invalid/v1' } });
  });
  try {
    assert.equal((await (await mf.dispatchFetch('http://worker.test/account')).json()).error, 'openrouter_failed');
    assert.equal((await (await mf.dispatchFetch('http://worker.test/catalog')).json()).error, 'provider_unavailable');
    assert.equal(seen.includes('redirect.invalid'), false);
  } finally {
    await mf.dispose();
  }
});
