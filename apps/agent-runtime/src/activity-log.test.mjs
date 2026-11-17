import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.mjs';
import { BIP39_ENGLISH } from './bip39-english.mjs';
import { redactForLog, redactLogText } from './activity-log.mjs';

const SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PUBKEY = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

/*
 * Achieves: redactForLog/redactLogText keep safe fields and scrub seeds, keys, grants, bearer, long hex.
 * Fails when: SEED appears in output, ordinary note redacted, or bearer not scrubbed.
 * Oracle: goal keeps fund/please without abandon; grant/privateKey/seedPhrase/apiKey/viewerUrl/secretKey/mnemonic '[redacted]'; text redactions.
 * Side effects / state checked: N/A.
 * Gaps: none for listed patterns
 */
test('activity redaction keeps ordinary fields and drops key material', () => {
  assert.equal(BIP39_ENGLISH.length, 2048);
  assert.equal(BIP39_ENGLISH[0], 'abandon');
  assert.equal(BIP39_ENGLISH.at(-1), 'zoo');

  const secretBytes = Array.from({ length: 64 }, (_, index) => index);
  const logged = redactForLog({
    goal: `fund ${SEED} please`,
    note: 'please watch this pool and send the report after each hour today',
    address: PUBKEY,
    amount: '10',
    digest: 'ab'.repeat(32),
    grant: 'cd'.repeat(32),
    privateKey: 'do-not-store',
    seedPhrase: SEED,
    apiKey: 'service-secret',
    viewerUrl: 'https://live.browser.run/ui/view?session=abc',
    secretKey: secretBytes,
    nested: { mnemonic: 'legal winner thank year wave sausage worth useful legal winner thank yellow' },
  });

  assert.match(logged.goal, /fund/);
  assert.match(logged.goal, /please/);
  assert.equal(logged.goal.includes('abandon'), false);
  assert.equal(logged.note, 'please watch this pool and send the report after each hour today');
  assert.equal(logged.address, PUBKEY);
  assert.equal(logged.amount, '10');
  assert.equal(logged.digest, 'ab'.repeat(32));
  assert.equal(logged.grant, '[redacted]');
  assert.equal(logged.privateKey, '[redacted]');
  assert.equal(logged.seedPhrase, '[redacted]');
  assert.equal(logged.apiKey, '[redacted]');
  assert.equal(logged.viewerUrl, '[redacted]');
  assert.equal(logged.secretKey, '[redacted]');
  assert.equal(logged.nested.mnemonic, '[redacted]');
  assert.equal(JSON.stringify(logged).includes(SEED), false);

  assert.equal(redactLogText(`pay ${'2'.repeat(88)} now`).includes('2'.repeat(20)), false);
  assert.match(redactLogText('Authorization: Bearer super-secret-token'), /Bearer \[redacted\]/);
  assert.match(redactLogText('wallet-auth:abcdef123456'), /\[redacted\]/);
  assert.equal(redactLogText(`hex ${'ab'.repeat(64)} end`).includes('ab'.repeat(40)), false);
});

/*
 * Achieves: wake activity_logs POST stores redacted body without seed/privateKey/bearer.
 * Fails when: SEED/privateKey/bearer appear in posted body, or activity_logs not written.
 * Oracle: 200; one POST to activity_logs; body excludes secrets and includes [redacted]/owner/bot.
 * Side effects / state checked: Supabase activity_logs write captured.
 * Gaps: none
 */
test('configured requests are stored without seed phrases or private keys', async () => {
  const seen = [];
  const fetcher = async (url, init = {}) => {
    seen.push({ url: String(url), method: init.method, body: init.body });
    return new Response('[]', {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  };
  const env = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    fetch: fetcher,
    BOT: {
      idFromName: name => name,
      get: () => ({ fetch: async () => Response.json({ ok: true, goal: 'kept' }) }),
    },
  };
  const response = await worker.fetch(new Request('https://runtime/bots/bot_1/wake', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-owner-id': 'user_1', authorization: 'Bearer should-not-log' },
    body: JSON.stringify({ goal: `fund ${SEED} please`, privateKey: 'do-not-store', amount: '10' }),
  }), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.equal(seen.length, 1);
  assert.match(seen[0].url, /\/rest\/v1\/activity_logs$/);
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].body.includes(SEED), false);
  assert.equal(seen[0].body.includes('do-not-store'), false);
  assert.equal(seen[0].body.includes('should-not-log'), false);
  assert.match(seen[0].body, /fund/);
  assert.match(seen[0].body, /\[redacted\]/);
  assert.match(seen[0].body, /user_1/);
  assert.match(seen[0].body, /bot_1/);
});
