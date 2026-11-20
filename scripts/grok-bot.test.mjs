import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GrokBotCliError, runGrokBotCli } from './grok-bot.mjs';

const SIG = '5'.repeat(88);
const SECRET = 'sk_test_example_value';
const root = fileURLToPath(new URL('..', import.meta.url));

const events = [{
  id: 'evt_1',
  botId: 'bot_1',
  botName: 'APY hunter',
  kind: 'tx.confirmed',
  cluster: 'mainnet-beta',
  signature: SIG,
  summary: `Landed with ${SECRET}`,
  at: 1_700_000_000_000,
  asset: 'USDC',
  amount: '5000000',
}];

const chat = {
  id: 'chat_1',
  title: 'Watch the wallet',
  exportedAt: 1_700_000_100_000,
  messages: [
    { id: 'm1', role: 'user', at: 1_700_000_000_000, text: 'What confirmed?' },
    { id: 'm2', role: 'assistant', at: 1_700_000_050_000, text: `5 USDC. key ${SECRET}` },
  ],
};

/**
 * Achieves: runGrokBotCli draft/export redact secrets; invalid commands/JSON throw GrokBotCliError.
 * Fails when: Secrets survive draft/export, or bad input exits successfully.
 * Oracle: scripts/grok-bot.mjs CLI over package helpers.
 * Side effects: none
 * Gaps: none meaningful
 */
test('cli drafts an offline post payload and exports markdown without the secret', () => {
  const drafted = runGrokBotCli(['draft'], JSON.stringify(events));
  const payload = JSON.parse(drafted);
  assert.equal(payload.delivery, 'offline');
  assert.equal(payload.networkCalls, 0);
  assert.equal(drafted.includes(SECRET), false);
  const markdown = runGrokBotCli(['export', '--markdown'], JSON.stringify(chat));
  assert.match(markdown, /^# Grok Bot chat export/);
  assert.equal(markdown.includes(SECRET), false);
  assert.throws(() => runGrokBotCli(['post'], '{}'), GrokBotCliError);
  assert.throws(() => runGrokBotCli(['draft'], ''), GrokBotCliError);
  assert.throws(() => runGrokBotCli(['export'], '{'), GrokBotCliError);
});

/**
 * Achieves: Spawned draft with X_BEARER_TOKEN still offline/undelivered and never prints the token; empty export exits 1.
 * Fails when: Token appears in stdout/stderr or posts marked delivered.
 * Oracle: Process-level offline + redaction invariant.
 * Side effects: Spawns child process with env token.
 * Gaps: none meaningful
 */
test('cli process does not echo an X token from the environment', () => {
  const result = spawnSync(process.execPath, ['scripts/grok-bot.mjs', 'draft'], {
    cwd: root,
    input: JSON.stringify(events),
    encoding: 'utf8',
    env: { PATH: process.env.PATH, X_BEARER_TOKEN: 'super-secret-token' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.includes('super-secret-token'), false);
  assert.equal(result.stdout.includes(SECRET), false);
  assert.equal(JSON.parse(result.stdout).posts[0].delivered, false);
  const refused = spawnSync(process.execPath, ['scripts/grok-bot.mjs', 'export'], {
    cwd: root,
    input: '',
    encoding: 'utf8',
    env: { PATH: process.env.PATH },
  });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /JSON on stdin/);
});
