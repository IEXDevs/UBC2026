import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EVENT_KINDS,
  GROK_BOT_ROLE,
  GrokBotError,
  exportGrokChat,
  grokSpendRequest,
  prepareNotablePosts,
  redactSecrets,
  selectNotableOnchainEvents,
} from './grok-bot.mjs';

const SIG_A = '5'.repeat(88);
const SIG_B = '4'.repeat(88);
const SECRET = 'sk_test_example_value';

function event(overrides = {}) {
  return {
    id: 'evt_1',
    botId: 'bot_1',
    botName: 'APY hunter',
    kind: 'tx.confirmed',
    cluster: 'devnet',
    signature: SIG_A,
    summary: 'Devnet USDC transfer landed in the bot wallet.',
    at: 1_700_000_000_000,
    asset: 'USDC',
    amount: '5000000',
    ...overrides,
  };
}

test('notable on-chain events are confirmed moves with a devnet signature', () => {
  const quiet = event({
    id: 'evt_quiet',
    kind: 'run.checkpoint',
    signature: undefined,
    summary: 'Checkpoint saved.',
  });
  const pending = event({ id: 'evt_pending', kind: 'tx.submitted', signature: '3'.repeat(88), at: 2 });
  const mainnet = event({ id: 'evt_main', cluster: 'mainnet', signature: '2'.repeat(88), at: 3 });
  const unsigned = event({ id: 'evt_unsigned', signature: undefined, at: 4 });
  const older = event({ id: 'evt_old', signature: SIG_B, at: 5, summary: 'Older grab.', kind: 'funds.grabbed', amount: '1000000' });
  const duplicate = event({ id: 'evt_dup', at: 6, summary: 'Same signature, later copy.' });
  const selected = selectNotableOnchainEvents([quiet, pending, mainnet, unsigned, event(), older, duplicate]);
  assert.deepEqual(selected.map(item => item.id), ['evt_old', 'evt_1']);
  assert.equal(EVENT_KINDS.includes('tx.confirmed'), true);
});

test('post payload stays offline and omits secrets even if an X token is set', () => {
  const calls = [];
  const previous = globalThis.fetch;
  globalThis.fetch = (...args) => {
    calls.push(args);
    throw new Error('network');
  };
  process.env.X_BEARER_TOKEN = 'super-secret-token';
  try {
    const payload = prepareNotablePosts([
      event({ summary: `Landed. OPENROUTER_API_KEY=${SECRET} Bearer ${SECRET}` }),
    ]);
    assert.equal(payload.destination, 'x');
    assert.equal(payload.delivery, 'offline');
    assert.equal(payload.networkCalls, 0);
    assert.equal(payload.reason, 'live_x_withheld');
    assert.equal(payload.posts.length, 1);
    assert.equal(payload.posts[0].delivered, false);
    assert.equal(payload.posts[0].text.length <= 280, true);
    assert.match(payload.posts[0].text, new RegExp(`explorer\\.solana\\.com/tx/${SIG_A}\\?cluster=devnet`));
    assert.match(payload.posts[0].text, /APY hunter — transaction confirmed \(5 USDC\)/);
    const encoded = JSON.stringify(payload);
    assert.equal(encoded.includes(SECRET), false);
    assert.equal(encoded.includes('super-secret-token'), false);
    assert.match(encoded, /OPENROUTER_API_KEY=\[redacted\]/);
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = previous;
    delete process.env.X_BEARER_TOKEN;
  }
});

test('long summaries are trimmed to the X character limit and bursts keep the newest 20', () => {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const long = prepareNotablePosts([event({ summary: `${'word '.repeat(99)}end` })]);
  assert.equal(long.posts[0].text.length <= 280, true);
  assert.match(long.posts[0].text, /…/);
  const wide = prepareNotablePosts([event({
    botName: 'N'.repeat(64),
    signature: '9'.repeat(128),
    amount: '9'.repeat(40),
    summary: 'S'.repeat(500),
    cluster: 'testnet',
  })]);
  assert.equal(wide.posts[0].text.length <= 280, true);
  assert.match(wide.posts[0].text, /9{128}/);
  const burst = Array.from({ length: 21 }, (_, index) => event({
    id: `evt_${index}`,
    signature: `${alphabet[index]}${'2'.repeat(87)}`,
    at: 1_000 + index,
    summary: `Event ${index}`,
    amount: undefined,
    asset: undefined,
  }));
  const posts = prepareNotablePosts(burst).posts;
  assert.equal(posts.length, 20);
  assert.equal(posts[0].eventId, 'evt_1');
  assert.equal(posts.at(-1).eventId, 'evt_20');
});

test('QuickNode stream rows draft the same offline payload', () => {
  const wallet = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  const payload = prepareNotablePosts([
    {
      signature: '6'.repeat(88),
      wallet,
      type: 'deposit',
      amount: '2500000',
      token: 'USDC',
      slot: 42,
      botId: 'bot_1',
    },
    {
      signature: '7'.repeat(88),
      wallet,
      type: 'unknown',
      amount: null,
      token: null,
      slot: 43,
    },
  ]);
  assert.equal(payload.networkCalls, 0);
  assert.equal(payload.posts.length, 1);
  assert.equal(payload.posts[0].kind, 'deposit');
  assert.equal(payload.posts[0].botId, 'bot_1');
  assert.match(payload.posts[0].text, /deposit landed \(2\.5 USDC\)/);
  assert.match(payload.posts[0].text, /cluster=devnet/);
  assert.throws(() => prepareNotablePosts([{ signature: 'nope', wallet, type: 'deposit' }]), GrokBotError);
});

test('malformed events are refused and non-execution clusters are not drafted', () => {
  assert.throws(() => prepareNotablePosts([event({ kind: 'secret.leak' })]), GrokBotError);
  assert.throws(() => prepareNotablePosts([event({ signature: 'not-a-signature' })]), GrokBotError);
  assert.deepEqual(prepareNotablePosts([]).posts, []);
  assert.equal(prepareNotablePosts([event({ kind: 'kill.stop-all', signature: undefined, summary: 'Switch flipped locally.' })]).posts.length, 0);
});

test('chat export redacts secrets and can render markdown', () => {
  const exported = exportGrokChat({
    id: 'chat_1',
    title: 'Watch the APY hunter wallet',
    exportedAt: 1_700_000_100_000,
    messages: [
      { id: 'm1', role: 'user', at: 1_700_000_000_000, text: 'What landed on devnet?' },
      { id: 'm2', role: 'assistant', at: 1_700_000_050_000, text: `Confirmed 5 USDC. Drop this key: ${SECRET}` },
      { id: 'm3', role: 'tool', at: 1_700_000_060_000, text: 'Draft withheld. wallet-auth:abcdef0123456789' },
    ],
  }, { format: 'both' });
  assert.equal(exported.schema, 'maelstrom.grok-chat-export.v1');
  assert.equal(exported.messageCount, 3);
  assert.equal(exported.role, GROK_BOT_ROLE);
  assert.equal(GROK_BOT_ROLE.split(/(?<=\.)\s+/).length, 4);
  const encoded = `${JSON.stringify(exported)}\n${exported.markdown}`;
  assert.equal(encoded.includes(SECRET), false);
  assert.equal(encoded.includes('wallet-auth:'), false);
  assert.match(exported.messages[1].text, /\[redacted\]/);
  assert.match(exported.markdown, /## assistant · 2023-11-14T22:14:10.000Z/);
  assert.match(exported.markdown, /## tool · /);
  assert.match(redactSecrets(`Authorization: Bearer ${SECRET} more`), /Bearer \[redacted\]/);
});

test('Grok Bot spend uses the same permissioned spend request as the app', () => {
  const request = grokSpendRequest({
    permission: 'full',
    botId: 'bot_1',
    action: 'pay',
    amount: '1000',
    destination: '11111111111111111111111111111111',
  });
  assert.equal(request.method, 'POST');
  assert.equal(request.path, '/api/spend');
  assert.equal(request.body.permission, 'full');
  assert.equal(request.body.action, 'pay');
  assert.equal(request.body.confirmed, false);
  assert.equal(JSON.stringify(request).includes('signature'), false);
});

test('the module source has no X client', () => {
  const source = readFileSync(new URL('./grok-bot.mjs', import.meta.url), 'utf8');
  assert.equal(source.includes('fetch('), false);
  assert.equal(source.includes('api.x.com'), false);
  assert.equal(source.includes('api.twitter.com'), false);
  assert.throws(() => exportGrokChat({ id: 'chat_1', title: 't', exportedAt: 1, messages: [] }), GrokBotError);
});
