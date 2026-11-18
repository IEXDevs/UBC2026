import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addCatalogFiles,
  catalogForChat,
  catalogRecallText,
  catalogStorageKey,
  normalizeCatalog,
  readCatalog,
  writeCatalog,
} from './file-catalog.mjs';

function memory() {
  const data = {};
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
  };
}

const PNG = 'data:image/png;base64,aaaa';

/**
 * Achieves: verifies the catalog keeps names and image previews, and drops blob URLs and file text.
 * Fails when: a blob URL is written, a note field survives, or the image data URL is stripped.
 * Oracle: stored shot.png url is the data URL; note is absent; blob url is absent.
 * Side effects / state checked: in-memory storage only.
 * Gaps: none for catalog persistence.
 */
test('the catalog keeps file names and hosted image previews', () => {
  const storage = memory();
  const library = addCatalogFiles({}, 'bot_1', [
    { id: 'a', name: 'shot.png', type: 'image/png', size: 12, url: PNG, note: 'pixel bytes of a secret', ref: 'ab'.repeat(32) },
    { id: 'b', name: 'notes.txt', type: 'text/plain', size: 4, url: 'blob:http://local/abc', body: 'secret contents' },
  ]);
  assert.equal(writeCatalog(storage, 'did:privy:1', library), true);
  const saved = readCatalog(storage, 'did:privy:1');
  assert.equal(saved.bot_1[0].name, 'shot.png');
  assert.equal(saved.bot_1[0].url, PNG);
  assert.equal(saved.bot_1[0].ref, 'ab'.repeat(32));
  assert.equal(saved.bot_1[0].note, undefined);
  assert.equal(saved.bot_1[1].name, 'notes.txt');
  assert.equal(saved.bot_1[1].url, undefined);
  assert.equal(saved.bot_1[1].body, undefined);
  assert.deepEqual(readCatalog(storage, 'did:privy:other'), {});
});

/**
 * Achieves: verifies the model prompt lists names and leaves preview URLs and file bodies out.
 * Fails when: the data URL or a contents field appears in the recall text.
 * Oracle: text includes shot.png and Nova, and does not include base64 or "secret contents".
 * Side effects / state checked: N/A.
 * Gaps: none for the recall prompt.
 */
test('agent recall lists names and skips file contents', () => {
  const entries = catalogForChat({
    bot_1: [{ id: 'a', name: 'shot.png', type: 'image/png', url: PNG, body: 'secret contents' }],
  }, [{ id: 'bot_1', name: 'Nova' }]);
  const text = catalogRecallText(entries);
  assert.match(text, /shot\.png/);
  assert.match(text, /Nova/);
  assert.equal(text.includes('base64'), false);
  assert.equal(text.includes('secret contents'), false);
  assert.equal(catalogRecallText([]), '');
});

/**
 * Achieves: verifies junk catalogs and bad owner ids do not persist.
 * Fails when: a javascript URL is kept or an empty owner writes a key.
 * Oracle: javascript URL dropped; catalogStorageKey('') is ''.
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('catalog storage rejects a bad preview and an empty owner', () => {
  const saved = normalizeCatalog({
    bot_1: [{ id: 'a', name: 'page.html', url: 'javascript:alert(1)' }],
  });
  assert.equal(saved.bot_1[0].url, undefined);
  assert.equal(catalogStorageKey(''), '');
  assert.equal(catalogStorageKey(null), '');
});
