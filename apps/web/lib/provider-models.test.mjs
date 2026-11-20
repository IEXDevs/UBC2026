import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveProvider } from './provider-tokens.mjs';
import { accountProviderModels, aiProvider, checkProviderModels, fallbackAccountModels, parseModelProvider, parseProviderModels } from './ai-provider.mjs';
import {
  ACCOUNT_PROVIDER, forgetProviderModels, modelOptionKey, readModelCatalogs,
  saveModelCatalog, selectedModelRequest, setModelVisible, visibleModelOptions,
} from './provider-models.mjs';
import { completeTextChat } from './text-chat.mjs';
import { providerStorage } from './provider-storage.mjs';

const token = 'synthetic-test-key-not-a-credential';
const baseUrl = 'https://api.openai.com/v1';
const models = [{ id: 'gpt-test-a', name: 'Model A' }, { id: 'gpt-test-b', name: 'Model B' }];
function memory() {
  const rows = new Map();
  return { getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value) };
}

test('account switches isolate provider credentials and model choices without adopting unowned keys', () => {
  const browser = memory();
  const ownerA = providerStorage(browser, 'did:privy:owner-a');
  const ownerB = providerStorage(browser, 'did:privy:owner-b');
  const draft = { name: 'Work', token, baseUrl };
  saveProvider(browser, draft); // Old browser-wide data has no trustworthy owner.
  assert.equal(visibleModelOptions(ownerA).some(row => row.providerId !== ACCOUNT_PROVIDER), false);
  const provider = saveProvider(ownerA, draft).provider;
  saveModelCatalog(ownerA, provider.id, models);
  const key = modelOptionKey(provider.id, models[0].id);
  assert.equal(selectedModelRequest(ownerA, key).modelProvider.token, token);
  assert.equal(selectedModelRequest(ownerB, key), null);
  setModelVisible(ownerA, key, false);
  saveProvider(ownerB, { ...draft, token: 'synthetic-other-owner-key' });
  saveModelCatalog(ownerB, provider.id, models);
  assert.equal(selectedModelRequest(ownerB, key).modelProvider.token, 'synthetic-other-owner-key');
  assert.equal(selectedModelRequest(ownerA, key), null);
  assert.equal(selectedModelRequest(providerStorage(browser, null), key), null);
  assert.throws(() => saveProvider(providerStorage(browser, null), draft), /provider_owner_required/);
});

test('model choices default on, hidden choices persist across discovery, and provider IDs stay separate', () => {
  const storage = memory();
  const provider = saveProvider(storage, { name: 'Work', token, baseUrl }).provider;
  saveModelCatalog(storage, ACCOUNT_PROVIDER, models);
  saveModelCatalog(storage, provider.id, models);
  assert.equal(visibleModelOptions(storage).length, 4);
  const key = modelOptionKey(provider.id, models[0].id);
  setModelVisible(storage, key, false);
  assert.equal(visibleModelOptions(storage).length, 3);
  assert.ok(visibleModelOptions(storage).some(row => row.key === models[0].id));
  saveModelCatalog(storage, provider.id, [...models, { id: 'gpt-test-c', name: 'Model C' }]);
  assert.equal(visibleModelOptions(storage).some(row => row.key === key), false);
  assert.ok(visibleModelOptions(storage).some(row => row.id === 'gpt-test-c'));
  setModelVisible(storage, key, true);
  assert.deepEqual(selectedModelRequest(storage, key), { model: models[0].id, modelProvider: { baseUrl, token } });
  assert.equal(JSON.stringify(readModelCatalogs(storage)).includes(token), false);
  forgetProviderModels(storage, provider.id);
  assert.equal(selectedModelRequest(storage, key), null);
});

test('all models can be hidden without silently reintroducing a fallback', () => {
  const storage = memory();
  saveModelCatalog(storage, ACCOUNT_PROVIDER, models);
  for (const model of models) setModelVisible(storage, model.id, false);
  assert.deepEqual(visibleModelOptions(storage), []);
  assert.equal(selectedModelRequest(storage, models[0].id), null);
  saveModelCatalog(storage, ACCOUNT_PROVIDER, []);
  assert.deepEqual(visibleModelOptions(storage), []);
});

test('catalog normalization includes non-reasoning chat models but excludes duplicates and incompatible models', () => {
  const data = [...models, models[0], { id: 'not a model' }, { id: 'text-embedding-3-small' }, { id: 'gpt-4o-audio-preview' }];
  assert.deepEqual(parseProviderModels({ data }, 'openai').map(row => row.id), models.map(row => row.id));
  assert.equal(parseProviderModels({ data: [{ id: 'vendor/chat', supported_parameters: ['tools'] }, { id: 'vendor/image', architecture: { output_modalities: ['image'] } }] }, 'openrouter').length, 1);
});

test('Meta discovery, cached choices, and inference only use Muse Spark 1.3 Contributor', async () => {
  const storage = memory();
  const baseUrl = 'https://api.meta.ai/v1';
  const meta = saveProvider(storage, { name: 'Meta', token, baseUrl }).provider;
  const contributor = 'muse-spark-1.3-contributor';
  const retired = 'muse-wonder-1.0';
  const data = [{ id: retired }, { id: contributor }, { id: 'another-meta-model' }];
  const catalog = await checkProviderModels({ baseUrl, apiKey: token, fetcher: async () => Response.json({ data }) });
  assert.deepEqual(catalog.models.map(row => row.id), [contributor]);
  saveModelCatalog(storage, ACCOUNT_PROVIDER, data);
  saveModelCatalog(storage, meta.id, data);
  assert.deepEqual(visibleModelOptions(storage).map(row => row.key), [contributor, modelOptionKey(meta.id, contributor)]);
  assert.equal(selectedModelRequest(storage, retired), null);
  for (const options of [{ metaModelApiKey: token }, { modelProvider: { token, baseUrl } }]) {
    const reply = await completeTextChat({
      ...options, model: retired, message: 'Hello',
      fetcher: async (_url, init) => {
        const body = JSON.parse(init.body);
        assert.equal(body.model, contributor);
        return Response.json({ choices: [{ message: { content: init.body.includes('Role: turn-verify') ? '{"allow":true}' : 'Hello' } }] });
      },
    });
    assert.equal(reply.model, contributor);
  }
});

test('model checks only contact supported exact HTTPS roots and never echo raw errors or credentials', async () => {
  for (const url of ['http://api.openai.com/v1', 'https://api.openai.com.evil/v1', 'https://localhost/v1', 'https://api.openai.com/v1?key=bad', 'https://user:pass@api.openai.com/v1']) {
    assert.equal(aiProvider(url), null);
    assert.equal(parseModelProvider({ baseUrl: url, token }), null);
  }
  let called = false;
  const rejected = await checkProviderModels({ baseUrl: 'https://localhost/v1', apiKey: token, fetcher: () => { called = true; } });
  assert.equal(called, false);
  assert.equal(rejected.ok, false);
  const success = await checkProviderModels({ baseUrl, apiKey: token, fetcher: async (url, init) => {
    assert.equal(url, `${baseUrl}/models`);
    assert.equal(init.headers.Authorization, `Bearer ${token}`);
    assert.equal(init.redirect, 'manual');
    return Response.json({ data: models });
  } });
  assert.equal(success.models.length, 2);
  const failure = await checkProviderModels({ baseUrl, apiKey: token, fetcher: async () => { throw new Error(token); } });
  assert.equal(JSON.stringify(failure).includes(token), false);
  const denied = await checkProviderModels({ baseUrl, apiKey: token, fetcher: async () => Response.json({ error: token }, { status: 401 }) });
  assert.equal(denied.error, 'provider_unauthorized');
});

test('a selected custom model uses its key and endpoint with the existing turn verifier and redaction', async () => {
  let calls = 0;
  const reply = await completeTextChat({
    metaModelApiKey: 'unused-account-key', model: 'gpt-test-a', modelProvider: { token, baseUrl }, message: `Hello ${token}`,
    fetcher: async (url, init) => {
      calls++;
      assert.equal(url, `${baseUrl}/chat/completions`);
      assert.equal(init.redirect, 'manual');
      assert.equal(init.headers.Authorization, `Bearer ${token}`);
      assert.equal(init.body.includes(token), false);
      const body = JSON.parse(init.body);
      assert.equal(body.model, 'gpt-test-a');
      return Response.json({ choices: [{ message: { content: init.body.includes('Role: turn-verify') ? '{"allow":true}' : 'Hello' } }] });
    },
  });
  assert.equal(reply.provider, 'openai');
  assert.equal(reply.text, 'Hello');
  assert.ok(calls > 1, 'the existing verifier still runs');
  await assert.rejects(completeTextChat({ modelProvider: { token, baseUrl: 'https://localhost/v1' }, message: 'Hello' }), error => error.code === 'provider_not_supported');
  await assert.rejects(completeTextChat({ modelProvider: { token, baseUrl }, message: 'Hello' }), error => error.code === 'model_required');
  await assert.rejects(completeTextChat({ modelProvider: { token, baseUrl }, model: 'gpt-test', message: 'Hello', fetcher: async () => Response.json({ error: { message: `Rejected ${token}` } }, { status: 401 }) }), error => !error.detail.includes(token));
});

test('custom OpenRouter models do not weaken the free-only policy for account keys', async () => {
  const model = 'vendor/paid-chat';
  const fetcher = async (_url, init) => Response.json({ choices: [{ message: { content: init.body.includes('Role: turn-verify') ? '{"allow":true}' : 'Hello' } }] });
  const accountReply = await completeTextChat({ openrouterApiKey: token, model, message: 'Hello', fetcher });
  assert.ok(accountReply.model.endsWith(':free'));
  const reply = await completeTextChat({ modelProvider: { token, baseUrl: 'https://openrouter.ai/api/v1' }, model, message: 'Hello', fetcher });
  assert.equal(reply.model, model);
  assert.equal(reply.provider, 'openrouter');
});

test('account catalogs never advertise router aliases that inference silently remaps', () => {
  const catalog = [{ id: 'openrouter/free' }, { id: 'vendor/chat:free' }, { id: 'vendor/paid-chat' }];
  assert.deepEqual(accountProviderModels(catalog, 'openrouter'), [{ id: 'vendor/chat:free' }]);
  assert.deepEqual(accountProviderModels(catalog, 'openai'), catalog);
  assert.ok(fallbackAccountModels('openrouter')[0].id.endsWith(':free'));
});

test('advertised thinking choices for newly discovered models reach inference', async () => {
  const [discovered] = parseProviderModels({ data: [{ id: 'gpt-new-reasoner', reasoning: { efforts: ['low', 'high'] } }] }, 'openai');
  const high = discovered.levels.find(level => level.id === 'high');
  let inference;
  await completeTextChat({
    modelProvider: { token, baseUrl }, model: discovered.id, reasoningEffort: high.label, message: 'Hello',
    fetcher: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (init.body.includes('Role: turn-verify')) return Response.json({ choices: [{ message: { content: '{"allow":true}' } }] });
      inference = body;
      return Response.json({ choices: [{ message: { content: 'Hello' } }] });
    },
  });
  assert.equal(inference.reasoning_effort, 'high');
});

test('model calls use a redirect mode Cloudflare Workers accepts and treat a 3xx as a failure', async () => {
  // workerd throws a TypeError for redirect 'error' before sending (every chat turn failed on dev).
  const workerdFetch = handler => async (url, init) => {
    if (init?.redirect !== undefined && !['follow', 'manual'].includes(init.redirect)) throw new TypeError('Invalid redirect value');
    return handler(url, init);
  };
  const ok = workerdFetch(async (_url, init) => Response.json({ choices: [{ message: { content: init.body.includes('Role: turn-verify') ? '{"allow":true}' : 'Hello' } }] }));
  const reply = await completeTextChat({ metaModelApiKey: 'LLM_synthetic-test-key', message: 'Hello', fetcher: ok });
  assert.equal(reply.text, 'Hello');
  const custom = await completeTextChat({ modelProvider: { token, baseUrl }, model: 'gpt-test-a', message: 'Hello', fetcher: ok });
  assert.equal(custom.text, 'Hello');
  const catalog = await checkProviderModels({ baseUrl, apiKey: token, fetcher: workerdFetch(async () => Response.json({ data: models })) });
  assert.equal(catalog.ok, true);
  const redirect = workerdFetch(async () => new Response(null, { status: 302, headers: { Location: 'https://evil.example/v1' } }));
  await assert.rejects(completeTextChat({ metaModelApiKey: 'LLM_synthetic-test-key', message: 'Hello', fetcher: redirect }), error => error.code === 'openrouter_failed');
  assert.equal((await checkProviderModels({ baseUrl, apiKey: token, fetcher: redirect })).error, 'provider_unavailable');
});
