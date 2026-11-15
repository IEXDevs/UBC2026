import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserSessionUrl, liveViewFrame, pickOpenSession } from './live-view.mjs';

test('browser session URLs stay on the runtime origin', () => {
  assert.equal(
    browserSessionUrl('https://runtime.example/agent/', 'bot_1'),
    'https://runtime.example/agent/bots/bot_1/browser/sessions',
  );
  assert.equal(
    browserSessionUrl('https://runtime.example', 'bot/1', { sessionRecordId: 'rec 1', action: 'live-view' }),
    'https://runtime.example/bots/bot%2F1/browser/sessions/rec%201/live-view',
  );
  assert.equal(browserSessionUrl('', 'bot_1'), null);
  assert.equal(browserSessionUrl('javascript:alert(1)', 'bot_1'), null);
  assert.equal(
    browserSessionUrl('shell', 'bot_1'),
    '/api/runtime/bots/bot_1/browser/sessions',
  );
  assert.equal(
    browserSessionUrl('shell', 'bot_1', { sessionRecordId: 'rec_1', action: 'live-view' }),
    '/api/runtime/bots/bot_1/browser/sessions/rec_1/live-view',
  );
});

test('only a verified live.browser.run URL is framed', () => {
  const framed = liveViewFrame({
    embedVerified: true,
    viewerUrl: 'https://live.browser.run/ui/view?jwt=secret',
    fallback: 'open-viewer-in-separate-tab',
  });
  assert.equal(framed.embed, true);
  assert.equal(framed.src, 'https://live.browser.run/ui/view?jwt=secret');
  assert.equal(framed.referrerPolicy, 'no-referrer');

  const linkOnly = liveViewFrame({
    embedVerified: false,
    viewerUrl: 'https://live.browser.run/ui/view?jwt=secret',
  });
  assert.equal(linkOnly.embed, false);
  assert.equal(linkOnly.src, 'https://live.browser.run/ui/view?jwt=secret');

  assert.equal(liveViewFrame({ embedVerified: true, viewerUrl: 'https://evil.example/ui/view?jwt=secret' }).src, null);
  assert.equal(liveViewFrame({ embedVerified: true, viewerUrl: 'http://live.browser.run/ui/view' }).src, null);
  assert.equal(liveViewFrame({ embedVerified: true, viewerUrl: 'https://live.browser.run/other?jwt=secret' }).embed, false);
});

test('pickOpenSession prefers the newest open record', () => {
  assert.equal(pickOpenSession({ sessions: [] }), null);
  const picked = pickOpenSession({
    sessions: [
      { sessionRecordId: 'old', status: 'open', createdAt: 1, updatedAt: 1 },
      { sessionRecordId: 'new', status: 'open', createdAt: 2, updatedAt: 5 },
      { sessionRecordId: 'closed', status: 'closed', createdAt: 9, updatedAt: 9 },
    ],
  });
  assert.equal(picked.sessionRecordId, 'new');
});
