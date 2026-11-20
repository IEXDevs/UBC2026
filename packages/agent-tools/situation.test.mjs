import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applySituation,
  groundBrowseUrl,
  groundSearchQuery,
  normalizeSituation,
  situationFromEdge,
  situationInstruction,
} from './situation.mjs';

const NOW = new Date('2026-11-19T16:33:00.000Z');

/**
 * Achieves: a valid zone and place survive, and junk cannot set the clock or the city.
 * Fails when: America/Chicago becomes UTC, a URL is kept as a place, or `at` follows the caller.
 * Oracle: normalizeSituation at 2026-11-19T16:33:00.000Z.
 * Side effects: none.
 */
test('situation keeps a real zone and place and drops junk', () => {
  const austin = normalizeSituation({
    timeZone: 'America/Chicago',
    place: 'Austin, Texas',
    locale: 'en-US',
    at: '1999-01-01T00:00:00.000Z',
  }, NOW);
  assert.equal(austin.at, '2026-11-19T16:33:00.000Z');
  assert.equal(austin.timeZone, 'America/Chicago');
  assert.equal(austin.place, 'Austin, Texas');
  assert.equal(austin.locale, 'en-US');

  const junk = normalizeSituation({
    timeZone: 'Not/AZone',
    place: 'https://evil.example',
    locale: 'nope!!',
  }, NOW);
  assert.equal(junk.timeZone, 'UTC');
  assert.equal(junk.place, '');
  assert.equal(junk.locale, '');
});

/**
 * Achieves: edge city and region fill place, and a client place wins.
 * Fails when: Cloudflare city is dropped, or a client place is overwritten.
 * Oracle: situationFromEdge fixtures.
 * Side effects: none.
 */
test('edge geo fills place when the client did not send one', () => {
  const edge = situationFromEdge(
    { timeZone: 'America/Chicago', locale: 'en-US' },
    { city: 'Austin', region: 'Texas', timezone: 'America/Chicago' },
    NOW,
  );
  assert.equal(edge.place, 'Austin, Texas');
  assert.equal(edge.timeZone, 'America/Chicago');
  const chosen = situationFromEdge(
    { place: 'Dallas, Texas', timeZone: 'America/Chicago' },
    { city: 'Austin', region: 'Texas' },
    NOW,
  );
  assert.equal(chosen.place, 'Dallas, Texas');
  const empty = situationFromEdge({}, { city: '<script>', region: '' }, NOW);
  assert.equal(empty.place, '');
  assert.equal(empty.timeZone, 'UTC');
});

/**
 * Achieves: the prompt lists local time and place, and refuses an invented city.
 * Fails when: Austin is missing, or a missing place still names a city.
 * Oracle: situationInstruction for America/Chicago at 16:33Z.
 * Side effects: none.
 */
test('situation instruction names the local clock and the place', () => {
  const note = situationInstruction({
    timeZone: 'America/Chicago',
    place: 'Austin, Texas',
    locale: 'en-US',
  }, NOW);
  assert.match(note, /November 19, 2026/);
  assert.match(note, /America\/Chicago/);
  assert.match(note, /Place: Austin, Texas/);
  assert.match(note, /Language: en-US/);
  assert.match(note, /near me/);
  const missing = situationInstruction({ timeZone: 'UTC' }, NOW);
  assert.match(missing, /Place is not set/);
  assert.match(missing, /Do not invent a city/);
  assert.doesNotMatch(missing, /Austin/);
});

/**
 * Achieves: local and time-bound queries gain place and date. Other queries stay exact.
 * Fails when: "near me" survives, SOL price gains a city, or weather in Paris is rewritten.
 * Oracle: groundSearchQuery fixtures.
 * Side effects: none.
 */
test('search queries gain place and date only when the ask is local or time-bound', () => {
  const situation = normalizeSituation({ timeZone: 'America/Chicago', place: 'Austin, Texas' }, NOW);
  assert.equal(groundSearchQuery('coffee near me', situation), 'coffee in Austin, Texas');
  assert.equal(
    groundSearchQuery('weather today', situation),
    'weather today Austin, Texas November 19, 2026',
  );
  assert.equal(groundSearchQuery('SOL price', situation), 'SOL price');
  assert.equal(groundSearchQuery('SOL price today', situation), 'SOL price today November 19, 2026');
  assert.equal(groundSearchQuery('weather in Paris', situation), 'weather in Paris');
  const noPlace = normalizeSituation({ timeZone: 'America/Chicago' }, NOW);
  assert.equal(groundSearchQuery('coffee near me', noPlace), 'coffee near me');
  assert.equal(groundSearchQuery('news today', noPlace), 'news today November 19, 2026');
});

/**
 * Achieves: a search-page query is grounded and a normal site URL is left alone.
 * Fails when: google q stays "near me", or example.com gains a city.
 * Oracle: groundBrowseUrl and applySituation.
 * Side effects: none.
 */
test('browser search URLs pick up the place and other pages do not', () => {
  const situation = normalizeSituation({ timeZone: 'America/Chicago', place: 'Austin, Texas' }, NOW);
  const grounded = groundBrowseUrl('https://www.google.com/search?q=coffee+near+me', situation);
  assert.match(grounded, /Austin/);
  assert.doesNotMatch(decodeURIComponent(grounded), /near me/i);
  assert.equal(
    groundBrowseUrl('https://example.com/menu', situation),
    'https://example.com/menu',
  );
  const args = applySituation('browser_navigate', {
    url: 'https://www.google.com/maps/search/?api=1&query=coffee+near+me',
  }, situation);
  assert.match(args.url, /Austin/);
  const price = applySituation('web_search', { query: 'SOL price' }, situation);
  assert.equal(price.query, 'SOL price');
});
