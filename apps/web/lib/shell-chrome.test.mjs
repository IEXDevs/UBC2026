import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isPlaceholderBotId,
  shellConnectors,
  withoutPlaceholderBots,
} from './shell-chrome.mjs';

test('placeholder bot ids are the old demo rail and nothing else', () => {
  assert.equal(isPlaceholderBotId('bot_meteora'), true);
  assert.equal(isPlaceholderBotId('bot_shop'), true);
  assert.equal(isPlaceholderBotId('bot_positions'), true);
  assert.equal(isPlaceholderBotId('bot_ada'), false);
  const cleaned = withoutPlaceholderBots({
    order: ['bot_meteora', 'bot_ada', 'bot_shop'],
    extra: [
      { id: 'bot_positions', name: 'Position guard' },
      { id: 'bot_ada', name: 'Ada' },
    ],
  });
  assert.deepEqual(cleaned.order, ['bot_ada']);
  assert.deepEqual(cleaned.extra.map(bot => bot.id), ['bot_ada']);
});

test('plugin catalog has no sample wallets or payments', () => {
  const rows = shellConnectors();
  assert.equal(rows.some(row => row.id === 'privy'), true);
  assert.equal(rows.some(row => /PreviewMain|bot_meteora|pay_/.test(JSON.stringify(row))), false);
});

test('the home shell does not render the demo fixture', () => {
  const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../app/page.js'), 'utf8');
  assert.equal(page.includes('getDemoShellState'), false);
  assert.equal(page.includes('demoBotExperiences'), false);
  assert.equal(page.includes('PreviewMain'), false);
  assert.equal(page.includes('bot_meteora'), false);
  assert.equal(page.includes('Sandbox shopper'), false);
});

test('claim handle stays outside the shell that fades on first login', () => {
  const root = dirname(fileURLToPath(import.meta.url));
  const page = readFileSync(join(root, '../app/page.js'), 'utf8');
  const css = readFileSync(join(root, '../app/globals.css'), 'utf8');
  assert.match(
    page,
    /<ProfileSheet[\s\S]*?\/>\s*<\/div>\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?\{setupStep === 'handle' \|\| claimWelcome \? \([\s\S]*?<ClaimHandle[\s\S]*?<DeskLock/,
  );
  assert.match(page, /setupStep === 'handle' \|\| claimWelcome \? ' is-claim'/);
  assert.match(css, /\.shell\.is-claim\s*\{[^}]*opacity:\s*0/);
  assert.match(css, /\.shell\.is-claim\s*\{[^}]*pointer-events:\s*none/);
});
