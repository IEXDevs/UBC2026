import assert from 'node:assert/strict';
import test from 'node:test';
import { byRecent, fileKind, filterLibrary, isLibraryImage, libraryGroups } from './file-library.mjs';

/**
 * Achieves: verifies MIME/name mapping into media, pages, and generic files buckets.
 * Fails when: png is not media, html is not pages, or markdown leaves the files bucket.
 * Oracle: image/png→media; text/html→pages; text/markdown→files.
 * Side effects / state checked: N/A.
 * Gaps: none for kind mapping.
 */
test('files sort into media, pages, and everything else', () => {
  assert.equal(fileKind({ name: 'shot.png', type: 'image/png' }), 'media');
  assert.equal(fileKind({ name: 'notes.html', type: 'text/html' }), 'pages');
  assert.equal(fileKind({ name: 'guide.md', type: 'text/markdown' }), 'files');
});

/**
 * Achieves: verifies this-week vs older split and media filter against a fixed clock.
 * Fails when: 8-day-old file lands in fresh, or media filter returns non-media rows.
 * Oracle: now=2026-11-14T00:00:00Z; 1-minute-old→fresh; 8-day-old→older; media filter empty on nameless rows.
 * Side effects / state checked: N/A.
 * Gaps: none for grouping helpers.
 */
test('this week and older split on the added time', () => {
  const now = Date.parse('2026-11-14T00:00:00Z');
  const groups = libraryGroups([
    { id: 'new', addedAt: now - 60_000 },
    { id: 'old', addedAt: now - 8 * 24 * 60 * 60 * 1000 },
  ], now);
  assert.deepEqual(groups.fresh.map(file => file.id), ['new']);
  assert.deepEqual(groups.older.map(file => file.id), ['old']);
  assert.equal(filterLibrary(groups.fresh, 'media').length, 0);
  const ordered = byRecent([
    { id: 'old', addedAt: 1, type: 'image/png', name: 'old.png' },
    { id: 'new', addedAt: 9, type: 'text/plain', name: 'new.txt' },
    { id: 'mid', addedAt: 4, type: 'image/jpeg', name: 'mid.jpg' },
  ]);
  assert.deepEqual(ordered.map(file => file.id), ['new', 'mid', 'old']);
  assert.deepEqual(ordered.filter(isLibraryImage).map(file => file.id), ['mid', 'old']);
});
