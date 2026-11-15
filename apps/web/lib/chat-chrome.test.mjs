import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'app/globals.css'), 'utf8');
const rail = readFileSync(join(root, 'components/AnimatedList.css'), 'utf8');
const bubbles = readFileSync(join(root, 'components/ChatBubbles.js'), 'utf8');
const page = readFileSync(join(root, 'app/page.js'), 'utf8');

test('message edit stays hidden until hover or focus on devices that can hover', () => {
  const gate = css.slice(css.indexOf("@media (hover: hover) and (pointer: fine) {\n  [data-slot='message'] .chat-edit"));
  assert.notEqual(gate, '');
  assert.match(gate, /\[data-slot='message'\] \.chat-edit \{\s*opacity: 0;/);
  assert.match(gate, /\[data-slot='message'\]:hover \.chat-edit/);
  assert.match(gate, /\[data-slot='message'\]:focus \.chat-edit/);
  assert.match(gate, /\[data-slot='message'\]:focus-within \.chat-edit/);
  assert.match(gate, /opacity: 0\.7/);
  const resting = css.slice(css.indexOf('.chat-edit {'), css.indexOf('.chat-edit:hover'));
  assert.match(resting, /opacity: 0\.7/);
  assert.match(bubbles, /tabIndex=\{onEdit && !editing \? 0 : undefined\}/);
});

test('chat message lists reuse the agent rail scrollbar', () => {
  assert.match(rail, /scrollbar-width: thin;/);
  assert.match(rail, /scrollbar-color: var\(--al-thumb\) transparent;/);
  assert.match(rail, /::-webkit-scrollbar \{\s*width: 6px;/);
  assert.match(rail, /::-webkit-scrollbar-track \{\s*background: transparent;/);
  assert.match(rail, /::-webkit-scrollbar-thumb \{\s*border-radius: 3px;\s*background: var\(--al-thumb\);/);
  const chat = css.slice(css.indexOf('.thread.is-chat,'), css.indexOf('.thread.is-book'));
  assert.match(chat, /\.voice-script \{/);
  assert.match(chat, /--al-thumb: rgba\(255, 255, 255, 0\.16\);/);
  assert.match(chat, /scrollbar-width: thin;/);
  assert.match(chat, /scrollbar-color: var\(--al-thumb\) transparent;/);
  assert.match(chat, /\.thread\.is-chat::-webkit-scrollbar,\s*\.voice-script::-webkit-scrollbar \{\s*width: 6px;/);
  assert.match(chat, /background: transparent;/);
  assert.match(chat, /border-radius: 3px;\s*background: var\(--al-thumb\);/);
  assert.match(page, /pane === 'Main' \? ' is-chat'/);
  assert.doesNotMatch(css, /\.voice-script,\s*\.voice-script \.chat-log/);
});
