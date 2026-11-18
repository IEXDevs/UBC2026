import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { searchRecall } from './recall-search.mjs';

const bots = [
  { id: 'bot_1', name: 'Nova', goal: 'Watch SOL funding' },
  { id: 'bot_2', name: 'Ledger', goal: 'Stay quiet' },
];
const talks = {
  bot_1: [
    { id: 'm1', role: 'user', text: 'Where is the funding note?' },
    { id: 'm2', role: 'agent', text: 'I have not opened it.' },
  ],
};
const files = {
  bot_1: [{ id: 'f1', name: 'funding-note.png', type: 'image/png', url: 'data:image/png;base64,fundingsecret' }],
  bot_2: [{ id: 'f2', name: 'quiet.txt', type: 'text/plain', body: 'funding lives in the body' }],
};

/**
 * Achieves: verifies search hits chats, message text, and file names, and ignores file bytes.
 * Fails when: a file body match is returned, or the named png is missing.
 * Oracle: kinds chat, message, file for "funding"; "fundingsecret" and the txt body produce no file hit.
 * Side effects / state checked: N/A.
 * Gaps: none for match scope.
 */
test('recall search matches chats, messages, and file names', () => {
  const hits = searchRecall({ query: 'funding', bots, talks, files });
  assert.deepEqual(hits.map(hit => hit.kind), ['chat', 'message', 'file']);
  assert.equal(hits[0].botId, 'bot_1');
  assert.equal(hits[1].lineId, 'm1');
  assert.equal(hits[2].label, 'funding-note.png');
  assert.equal(searchRecall({ query: 'fundingsecret', bots, talks, files }).some(hit => hit.kind === 'file'), false);
  assert.equal(searchRecall({ query: 'lives in the body', bots, talks, files }).length, 0);
  assert.deepEqual(searchRecall({ query: '   ', bots, talks, files }), []);
});

/**
 * Achieves: verifies the left pane mounts the recall search and passes the catalog into chat.
 * Fails when: page.js drops RecallSearch, the search label, or fileCatalog.
 * Oracle: page mounts RecallSearch and fileCatalog; the search placeholder is "Search chats and files".
 * Side effects / state checked: N/A.
 * Gaps: does not render the pane.
 */
test('the left pane wires the recall search', () => {
  const page = readFileSync(new URL('../app/page.js', import.meta.url), 'utf8');
  const search = readFileSync(new URL('../components/RecallSearch.jsx', import.meta.url), 'utf8');
  assert.match(page, /<RecallSearch/);
  assert.match(page, /fileCatalog/);
  assert.match(search, /Search chats and files/);
  assert.match(search, /glide-select/);
  const library = readFileSync(new URL('../components/FileLibrary.js', import.meta.url), 'utf8');
  assert.match(library, /FileStage/);
  assert.match(library, /FileScroll/);
});
