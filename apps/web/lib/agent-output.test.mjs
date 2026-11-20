import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatAgentOutput, linkParts } from './agent-output.mjs';

test('agent output truncates decimals toward zero without padding or rounding', () => {
  assert.equal(
    formatAgentOutput('Price $1,234.999, change -0.129%, ratio .987. Keep 12, 1.2, and 3.45.'),
    'Price $1,234.99, change -0.12%, ratio .98. Keep 12, 1.2, and 3.45.',
  );
  assert.equal(formatAgentOutput('9.009999 and 100000000000000000000.1999'), '9.00 and 100000000000000000000.19');
});

test('agent output preserves URLs, handles, code, and dotted identifiers', () => {
  const text = 'https://example.com/1.234 @agent-1.234 v1.234.5 10.123.0.1 `1.234`\n```js\nx = 1.234;\n```';
  assert.equal(formatAgentOutput(text), text);
});

test('chat formats agent and assistant replies at render time and leaves user text intact', () => {
  const bubbles = readFileSync(new URL('../components/ChatBubbles.js', import.meta.url), 'utf8');
  assert.match(bubbles, /<MentionText text=\{line\.text\}/);
  assert.match(bubbles, /className="chat-address"/);
  assert.match(bubbles, /line\.mentionAddress \? <CopyAddress address=\{line\.mentionAddress\}/);
  assert.equal(bubbles.includes('has-mention-address'), false);
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const address = css.slice(css.indexOf('.chat-address {'), css.indexOf('.chat-address small'));
  assert.match(address, /display:\s*inline/);
  assert.match(address, /font-weight:\s*700/);
  assert.match(address, /text-decoration:\s*underline/);
  assert.equal(address.includes('width:'), false);
  const composer = readFileSync(new URL('../components/Composer.js', import.meta.url), 'utf8');
  assert.match(composer, /if \(hint && !address\) pushLine\('assistant', hint, targetId\)/);
  assert.match(bubbles, /line\.role === 'agent' \|\| line\.role === 'assistant'\s*\? formatAgentOutput\(line\.text\)\s*: line\.text/);
  assert.match(bubbles, /linkParts\(text\)/);
  assert.match(bubbles, /className="chat-link"/);
  assert.match(bubbles, /const urls = urlsIn\(line\.text\)/);
});

test('link parts keep a Solscan URL as its own anchor', () => {
  const url = 'https://solscan.io/tx/abc?cluster=devnet';
  assert.deepEqual(linkParts(`Sent. ${url}`), [
    { type: 'text', value: 'Sent. ' },
    { type: 'link', value: url },
  ]);
  assert.deepEqual(linkParts('No link'), [{ type: 'text', value: 'No link' }]);
});
