import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maskToken, parseProviderDraft, publicProvider, readProviderViews, removeProvider, saveProvider } from './provider-tokens.mjs';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');

function memory() {
  const saved = new Map();
  return {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
  };
}

test('a saved provider keeps the token out of the catalog view', () => {
  const storage = memory();
  const token = 'sk-live-example-token-91af';
  const saved = saveProvider(storage, { name: 'OpenRouter', token, baseUrl: 'https://openrouter.ai/api/v1' });
  assert.equal(saved.ok, true);
  assert.equal(saved.provider.hint, maskToken(token));
  assert.equal('token' in saved.provider, false);
  assert.equal(JSON.stringify(readProviderViews(storage)).includes(token), false);
  const rejected = parseProviderDraft({ name: 'Bad', token: 'short', baseUrl: 'http://insecure.example' });
  assert.equal(rejected.ok, false);
  assert.equal(JSON.stringify(rejected).includes('short'), false);
  removeProvider(storage, saved.provider.id);
  assert.equal(readProviderViews(storage).length, 0);
  assert.equal(publicProvider(null), null);
});

test('provider management lives in Plugins, not profile or wallet settings', () => {
  const prompt = readFileSync(join(web, 'components/PromptBar.jsx'), 'utf8');
  const profile = readFileSync(join(web, 'components/ProfileSheet.js'), 'utf8');
  const wallets = readFileSync(join(web, 'components/WalletsSheet.js'), 'utf8');
  const plugins = readFileSync(join(web, 'components/PluginsSheet.js'), 'utf8');
  const providers = readFileSync(join(web, 'components/ModelProviders.js'), 'utf8');
  const dialog = readFileSync(join(web, 'components/ProviderAdd.js'), 'utf8');
  assert.match(prompt, /label: 'Add Provider'/);
  assert.doesNotMatch(profile, /ProviderAdd|provider-tokens|@richclub\.sol/);
  assert.doesNotMatch(wallets, /ProviderAdd|provider-tokens/);
  assert.match(plugins, />Model providers</);
  assert.match(plugins, /<ModelProviders/);
  assert.match(providers, /<ProviderAdd/);
  assert.match(providers, /readProviderViews/);
  assert.match(providers, /removeProvider/);
  assert.match(dialog, /saveProvider/);
  assert.match(dialog, /aria-labelledby="provider-add-title"/);
});
