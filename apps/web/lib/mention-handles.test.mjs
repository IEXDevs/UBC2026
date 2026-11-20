import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { filterMentionSuggestions, mentionSuggestions } from './mention-handles.mjs';

const root = dirname(fileURLToPath(import.meta.url));

/**
 * Achieves: verifies @ autofill lists the account handle, recent sends, and thread mentions.
 * Fails when: a .sol name, a duplicate, or a ninth row is offered, or the own handle loses its place.
 * Oracle: names are ilinus, ada, bob, cara; descriptions are Ada, Recent, Recent, In this chat.
 * Side effects / state checked: none.
 * Gaps: does not render the menu.
 */
test('@ autofill lists the account handle, recent sends, and thread mentions', () => {
  const rows = mentionSuggestions({
    handle: '@ilinus',
    displayName: 'Ada',
    transfers: [{ handle: 'ada' }, { handle: '@ada' }, { handle: 'bob' }],
    payments: [{ counterparty: 'ada.sol' }, { counterparty: 'not a name' }],
    lines: [{ text: 'ask @cara' }, { text: 'again @ada' }, { text: 'skip @' }],
  });
  assert.deepEqual(rows.map(row => row.name), ['ilinus', 'ada', 'bob', 'cara']);
  assert.deepEqual(rows.map(row => row.description), ['Ada', 'Recent', 'Recent', 'In this chat']);
  assert.equal(rows[0].key, 'ilinus');
});

/**
 * Achieves: verifies a typed prefix keeps matching handles and drops the rest.
 * Fails when: an empty query hides rows, or a miss still returns a row.
 * Oracle: empty query returns both; "bo" returns bob; "zzz" returns none.
 * Side effects / state checked: none.
 * Gaps: does not render the menu.
 */
test('a typed prefix keeps matching handles and drops the rest', () => {
  const rows = [
    { key: 'ada', name: 'ada', description: 'Recent' },
    { key: 'bob', name: 'bob', description: 'Recent' },
  ];
  assert.deepEqual(filterMentionSuggestions(rows, ''), rows);
  assert.deepEqual(filterMentionSuggestions(rows, 'bo').map(row => row.name), ['bob']);
  assert.deepEqual(filterMentionSuggestions(rows, 'zzz'), []);
  assert.deepEqual(filterMentionSuggestions(null, 'a'), []);
});

/**
 * Achieves: verifies the @ menu is handle rows in the composer flow, and an empty list stays closed.
 * Fails when: @ still lists attachment sources, the menu stays absolute, or a miss still paints the bar.
 * Oracle: PromptBar uses filterMentionSuggestions, data-kind handle, and hides a zero-length handle list.
 * Side effects / state checked: source files on disk.
 * Gaps: does not open a browser.
 */
test('the @ menu is handle rows in the composer flow, and an empty list stays closed', () => {
  const prompt = readFileSync(join(root, '../components/PromptBar.jsx'), 'utf8');
  const css = readFileSync(join(root, '../components/PromptBar.css'), 'utf8');
  const composer = readFileSync(join(root, '../components/Composer.js'), 'utf8');
  const page = readFileSync(join(root, '../app/page.js'), 'utf8');
  assert.match(prompt, /filterMentionSuggestions\(handles, query\)/);
  assert.match(prompt, /const menuOpen = open && \(open !== 'handle' \|\| list\.length > 0\)/);
  assert.match(prompt, /data-kind=\{open\}/);
  assert.match(prompt, /open === 'handle' \? `@\$\{row\.name\}`/);
  assert.match(css, /\.prompt-bar__menu\[data-kind='handle'\] \{[^}]*position: relative/s);
  assert.match(composer, /handles=\{mentionHandles\}/);
  assert.match(page, /mentionHandles=\{mentionSuggestions\(/);
});
