import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogAddition } from './file-catalog.mjs';
import { STORAGE_CAP_WARNING, STORAGE_FILE_TOO_BIG, USER_STORAGE_CAP } from './file-quota.mjs';

const GB = 1_000_000_000;

/**
 * Achieves: verifies a new upload past 5 GB keeps the new file and drops the oldest one.
 * Fails when: the old file survives, the new file is dropped, or the warning names a provider.
 * Oracle: kept id is new; warning includes "5 GB" and does not include Google or Drive.
 * Side effects / state checked: N/A.
 * Gaps: Drive delete runs when the upload path exists.
 */
test('crossing 5 GB drops the oldest file and warns without naming the store', () => {
  const library = {
    bot_a: [{ id: 'old', name: 'old.txt', type: 'text/plain', size: 4 * GB, addedAt: 1 }],
    bot_b: [{ id: 'mid', name: 'mid.txt', type: 'text/plain', size: 2 * GB, addedAt: 2 }],
  };
  const result = catalogAddition(library, 'bot_b', [
    { id: 'new', name: 'new.txt', type: 'text/plain', size: 2 * GB, addedAt: 3 },
  ]);
  const names = Object.values(result.library).flat().map(file => file.id).sort();
  assert.deepEqual(names, ['mid', 'new']);
  assert.equal(result.warning, STORAGE_CAP_WARNING);
  assert.match(result.warning, /5 GB/);
  assert.equal(/google|drive/i.test(result.warning), false);
  assert.equal(result.rejected.length, 0);
});

/**
 * Achieves: verifies a file larger than 5 GB is refused and the existing files stay.
 * Fails when: the huge file is stored or older files are wiped to make room for it.
 * Oracle: library still holds keep; rejected name is huge.bin; warning is empty.
 * Side effects / state checked: N/A.
 * Gaps: none for the oversize reject.
 */
test('a file over 5 GB is not saved and does not wipe older files', () => {
  const library = {
    bot_a: [{ id: 'keep', name: 'keep.txt', type: 'text/plain', size: GB, addedAt: 1 }],
  };
  const result = catalogAddition(library, 'bot_a', [
    { id: 'huge', name: 'huge.bin', type: 'application/octet-stream', size: USER_STORAGE_CAP + 1, addedAt: 2 },
  ]);
  assert.deepEqual(result.library.bot_a.map(file => file.id), ['keep']);
  assert.equal(result.rejected[0].name, 'huge.bin');
  assert.equal(result.warning, '');
  assert.equal(/google|drive/i.test(STORAGE_FILE_TOO_BIG), false);
});

/**
 * Achieves: verifies an upload under the cap keeps every file and stays quiet.
 * Fails when: a warning is returned or a file is removed below 5 GB.
 * Oracle: both ids remain; warning is empty.
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('an upload under 5 GB keeps older files', () => {
  const result = catalogAddition({
    bot_a: [{ id: 'old', name: 'old.txt', type: 'text/plain', size: GB, addedAt: 1 }],
  }, 'bot_a', [
    { id: 'new', name: 'new.txt', type: 'text/plain', size: GB, addedAt: 2 },
  ]);
  assert.deepEqual(result.library.bot_a.map(file => file.id).sort(), ['new', 'old']);
  assert.equal(result.warning, '');
});
