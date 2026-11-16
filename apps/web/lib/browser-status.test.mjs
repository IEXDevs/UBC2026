import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserErrorNote, browserStatusNote } from './browser-status.mjs';

test('browser status explains missing runtime and secrets', () => {
  assert.match(browserStatusNote({}), /Sign in/);
  assert.match(browserStatusNote({ ownerId: 'did:privy:x' }), /NEXT_PUBLIC_AGENT_RUNTIME_URL/);
  assert.match(
    browserStatusNote({
      ownerId: 'did:privy:x',
      runtimeBase: 'https://runtime.example',
      sessionUrl: 'https://runtime.example/bots/b1/browser/sessions',
    }),
    /No browser session yet/,
  );
  assert.match(
    browserStatusNote({
      ownerId: 'did:privy:x',
      runtimeBase: 'https://runtime.example',
      sessionUrl: 'https://runtime.example/bots/b1/browser/sessions',
      sessionRecordId: 'bs_1',
    }),
    /Show live view/,
  );
});

test('browser errors map Worker codes to setup hints', () => {
  assert.match(browserErrorNote('browser_not_configured'), /CLOUDFLARE_API_TOKEN/);
  assert.match(browserErrorNote('search_not_configured'), /FIRECRAWL/);
  assert.match(browserErrorNote('not_found'), /not found/i);
  assert.match(browserErrorNote('concurrency_limit'), /Release/);
});
