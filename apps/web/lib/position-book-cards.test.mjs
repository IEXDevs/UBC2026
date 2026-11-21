import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { layoutPositionBook } from './position-book.mjs';

const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../components/PositionBookCards.jsx', import.meta.url))],
  tsconfig: fileURLToPath(new URL('../jsconfig.json', import.meta.url)),
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  loader: { '.js': 'jsx' },
  external: ['react', 'react/jsx-runtime', 'react-dom'],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { WalletCard, ProviderGroupCard, ProviderPositionCard } = module.exports;

test('registry cards show the provider position apart from wallet USD holdings', () => {
  const address = 'So11111111111111111111111111111111111111112';
  const book = layoutPositionBook([{
    id: 'position', walletId: 'main', asset: 'SOL', market: 'SOL Perp', venue: 'Jupiter',
    side: 'long', sizeLabel: '$160 size', notionalMicroUsdc: '25000000',
  }], [], [{ id: 'main', label: 'Main wallet', address }], [
    { walletId: 'main', asset: 'SOL', amount: '1250000001', decimals: 9, notionalMicroUsdc: '100000000' },
    { walletId: 'main', asset: 'USDC', amount: '25000000', decimals: 6, notionalMicroUsdc: '25000000' },
    { walletId: 'main', asset: 'Unknown', notionalMicroUsdc: null },
  ]);
  const wallet = renderToStaticMarkup(createElement(WalletCard, { wallet: book.wallets[0] }));
  assert.match(wallet, /data-slot="card"/);
  assert.match(wallet, /Main wallet/);
  assert.match(wallet, /So111\.\.\.11112/);
  assert.match(wallet, /\$125/);
  assert.match(wallet, /SOL \$100, USDC \$25/);
  assert.match(wallet, /<title>SOL · \$100 · 1\.250000001 SOL · 80%<\/title>/);
  assert.match(wallet, /<title>USDC · \$25 · 25 USDC · 20%<\/title>/);
  const gradient = wallet.match(/<radialGradient id="([^"]+-0)"/)[1];
  assert.ok(wallet.includes(`fill="url(#${gradient})"`));
  assert.match(wallet, /class="book-wallet-sheen"[^>]*><ellipse[^>]*fill="url\(#[^"]+-sheen\)"/);
  assert.match(wallet, /1 unpriced/);
  assert.doesNotMatch(wallet, /Jupiter/);

  const group = renderToStaticMarkup(createElement(ProviderGroupCard, { account: book.accounts[0] }));
  assert.match(group, /data-slot="card-title"[^>]*>Jupiter/);
  const position = renderToStaticMarkup(createElement(ProviderPositionCard, { card: book.cards[0] }));
  assert.match(position, /data-slot="card"[^>]*book-front/);
  assert.match(position, /Jupiter · long/);
  assert.match(position, /\$160 size/);
  assert.doesNotMatch(position, /\$125/);
});
