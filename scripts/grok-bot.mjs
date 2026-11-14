/**
 * Draft an offline Grok Bot post payload, or export a Grok Bot chat.
 * Reads JSON on stdin. Does not read secret values or call the network.
 *
 *   node scripts/grok-bot.mjs draft
 *   node scripts/grok-bot.mjs export [--markdown]
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { exportGrokChat, prepareNotablePosts } from '../packages/grok-bot/grok-bot.mjs';

export class GrokBotCliError extends Error {}

function fail(message) {
  throw new GrokBotCliError(message);
}

export function runGrokBotCli(argv, raw) {
  const command = argv[0];
  const markdown = argv.includes('--markdown');
  const flags = argv.filter(arg => arg !== '--markdown');
  if (flags.length !== 1 || !['draft', 'export'].includes(command) || (markdown && command !== 'export')) {
    fail('Usage: node scripts/grok-bot.mjs draft | export [--markdown]');
  }
  if (typeof raw !== 'string' || raw.trim() === '') fail('Pass JSON on stdin.');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail('JSON on stdin could not be read.');
  }
  if (command === 'draft') {
    const payload = prepareNotablePosts(parsed);
    return `${JSON.stringify(payload, null, 2)}\n`;
  }
  const exported = exportGrokChat(parsed, { format: markdown ? 'markdown' : 'json' });
  if (markdown) return exported.markdown.endsWith('\n') ? exported.markdown : `${exported.markdown}\n`;
  return `${JSON.stringify(exported, null, 2)}\n`;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    process.stdout.write(runGrokBotCli(process.argv.slice(2), readFileSync(0, 'utf8')));
  } catch (error) {
    if (error instanceof GrokBotCliError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    } else if (error && error.name === 'GrokBotError') {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
