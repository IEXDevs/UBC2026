import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserSituation, mergeOwnerSituation, situationBody } from './owner-situation.mjs';

/**
 * Achieves: the browser zone is kept, the edge city fills place, and an empty clock is omitted.
 * Fails when: edge time overwrites the browser, or a blank situation is posted.
 * Oracle: mergeOwnerSituation and situationBody.
 * Side effects: none.
 */
test('owner situation prefers the browser clock and the edge place', () => {
  const merged = mergeOwnerSituation(
    { timeZone: 'America/Chicago', locale: 'en-US' },
    { timeZone: 'America/Los_Angeles', place: 'Austin, Texas' },
  );
  assert.equal(merged.timeZone, 'America/Chicago');
  assert.equal(merged.place, 'Austin, Texas');
  assert.equal(merged.locale, 'en-US');
  assert.equal(situationBody({}), null);
  assert.equal(situationBody({ timeZone: 'America/Chicago' }).timeZone, 'America/Chicago');
  const clock = browserSituation();
  assert.equal(typeof clock, 'object');
});
