import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL = 'So11111111111111111111111111111111111111112';
const BLOCKHASH = '11111111111111111111111111111111';
const KEY = 'synthetic-jupiter-test-key';
const wrangler = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
  .replace(/^\s*\/\/.*$/gm, ''));

function buildResponse() {
  const data = Buffer.alloc(34);
  createHash('sha256').update('global:route_v2').digest().copy(data, 0, 0, 8);
  data.writeBigUInt64LE(1_000_000n, 8);
  data.writeBigUInt64LE(10_000_000n, 16);
  data.writeUInt16LE(50, 24);
  return Response.json({
    inputMint: USDC, outputMint: SOL, inAmount: '1000000', outAmount: '10000000',
    otherAmountThreshold: '9950000', swapMode: 'ExactIn', slippageBps: 50,
    swapInstruction: {
      programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
      accounts: [USDC, BLOCKHASH, BLOCKHASH, USDC, SOL].map((pubkey, index) => ({ pubkey, isSigner: index === 0 })),
      data: data.toString('base64'),
    },
  });
}

test('the hosted swap builder reaches Jupiter and refuses redirects in workerd', async () => {
  const options = { inputMint: USDC, outputMint: SOL, amount: '1000000', walletAddress: USDC, blockhash: BLOCKHASH, apiKey: KEY };
  const result = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL('.', import.meta.url)),
      contents: `import { buildJupiterSwap } from '../../../packages/transfers/jupiter-swap.mjs';
        export default { async fetch() {
          try { return Response.json(await buildJupiterSwap(${JSON.stringify(options)})); }
          catch (error) { return Response.json({ error: error.code || error.message }); }
        } };`,
    },
    bundle: true, write: false, format: 'esm', platform: 'browser',
    conditions: ['workerd', 'worker', 'browser'], mainFields: ['module', 'main'], external: ['node:*'],
  });
  const hosts = [];
  let upstream = buildResponse;
  const worker = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: result.outputFiles[0].text,
    compatibilityDate: wrangler.compatibility_date, compatibilityFlags: wrangler.compatibility_flags,
    outboundService: async request => {
      const url = new URL(request.url);
      hosts.push(url.host);
      if (url.host !== 'api.jup.ag') return new Response(null, { status: 403 });
      assert.equal(url.pathname, '/swap/v2/build');
      assert.equal(request.headers.get('x-api-key'), KEY);
      return upstream();
    },
  }));
  try {
    const quote = await (await worker.dispatchFetch('http://worker.test/')).json();
    assert.equal(quote.error, undefined);
    assert.equal(quote.minOutput, '9950000');
    assert.ok(quote.transaction);
    const failures = [
      [() => Response.redirect('https://redirect.invalid/', 302), 'jupiter_redirect_refused'],
      [() => new Response('rate limited', { status: 429 }), 'jupiter_http_429'],
      [() => new Response('not JSON'), 'jupiter_quote_invalid_response'],
    ];
    for (const [reply, code] of failures) {
      upstream = reply;
      const failed = await (await worker.dispatchFetch('http://worker.test/')).json();
      assert.deepEqual(failed, { error: code });
    }
    assert.deepEqual(hosts, Array(1 + failures.length).fill('api.jup.ag'));
  } finally {
    await worker.dispose();
  }
});
