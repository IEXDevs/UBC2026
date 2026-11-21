import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadProviderPositions } from './provider-positions.mjs';

const WALLET = 'So11111111111111111111111111111111111111112';
const POSITION = '815wh1VLC8D7ZWMa3uB7GgjHFetANuML2dPrJiLV1nVF';
const POOL = 'A8Ui81JDgxgux4iL1iFVHma44Boi3Pcu7UD7Xkm1bDVJ';

test('reads real provider response shapes with exact USD units and keeps partial results', async () => {
  const requests = [];
  const result = await loadProviderPositions([{ address: WALLET }, { address: WALLET }, { address: 'invalid' }], {
    fetcher: async (url, options) => {
      requests.push(url.href);
      assert.equal(options.redirect, 'manual');
      assert.equal(options.headers, undefined);
      if (url.hostname === 'perps-api.jup.ag') {
        assert.equal(url.searchParams.get('walletAddress'), WALLET);
        assert.equal(url.searchParams.get('includeClosedPositions'), 'false');
        return Response.json({ dataList: [{ positionPubkey: POSITION, asset: 'SOL', assetMint: WALLET,
          side: 'short', leverage: '2.10', sizeUsd: '110990001', valueUsd: '32718456', pnlAfterFeesUsd: '-281544',
          entryPriceUsd: '112310000', markPriceUsd: '113400000' }, { positionPubkey: POOL, sizeUsd: '0' }] });
      }
      assert.equal(url.hostname, 'dlmm.datapi.meteora.ag');
      assert.equal(url.searchParams.get('user'), WALLET);
      if (url.searchParams.get('page') === '2') return new Response('private error', { status: 429 });
      return Response.json({ hasNext: true, pools: [{ poolAddress: POOL, tokenX: 'SOL', tokenY: 'USDC',
        openPositionCount: 2, balances: '20.0156451', pnl: '-2.0200301' }] });
    },
  });
  assert.equal(requests.length, 3);
  assert.deepEqual(result.incomplete, ['Meteora']);
  assert.deepEqual(result.positions.map(({ venue, sizeLabel, notionalMicroUsdc, pnlMicroUsdc, walletAddress }) =>
    [venue, sizeLabel, notionalMicroUsdc, pnlMicroUsdc, walletAddress]), [
    ['Jupiter', '$110.99 size', '32718456', '-281544', WALLET],
    ['Meteora', '2 open', '20015645', '-2020030', WALLET],
  ]);
  assert.equal(result.positions[0].positionAddress, POSITION);
  assert.equal(result.positions[1].positionAddress, POOL);
});

test('empty provider results differ from failures', async () => {
  const result = await loadProviderPositions([{ address: WALLET }], {
    fetcher: async url => url.hostname === 'perps-api.jup.ag'
      ? Response.redirect('https://example.invalid')
      : Response.json({ hasNext: false, pools: [] }),
  });
  assert.deepEqual(result, { positions: [], incomplete: ['Jupiter'] });
});
