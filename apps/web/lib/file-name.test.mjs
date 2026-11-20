import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalFileName, displayFileName, stuckFileNameParts } from './file-name.mjs';

test('canonicalFileName keeps one basename and never joins two files', () => {
  assert.equal(canonicalFileName('maelstrom-qa-fixture.txt'), 'maelstrom-qa-fixture.txt');
  assert.equal(canonicalFileName('C:\\\\Users\\\\a\\\\Untitled 3.txt'), 'Untitled 3.txt');
  assert.equal(canonicalFileName('folder/notes.txt'), 'notes.txt');
  assert.equal(canonicalFileName('  spaced   name.txt  '), 'spaced name.txt');
  assert.equal(canonicalFileName(''), '');
  assert.equal(canonicalFileName(null), '');
});

test('stuckFileNameParts splits concatenated extension names from the QA repro', () => {
  assert.deepEqual(
    stuckFileNameParts('Untitled 3.txtmaelstrom-qa-fixture.txt'),
    ['Untitled 3.txt', 'maelstrom-qa-fixture.txt'],
  );
  assert.equal(stuckFileNameParts('maelstrom-qa-fixture.txt'), null);
  assert.equal(displayFileName('Untitled 3.txtmaelstrom-qa-fixture.txt'), 'Untitled 3.txt · maelstrom-qa-fixture.txt');
});
