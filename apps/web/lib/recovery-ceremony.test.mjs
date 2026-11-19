import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ceremony = readFileSync(new URL('../components/RecoveryCeremony.js', import.meta.url), 'utf8');
const slide = readFileSync(new URL('../components/bits/SlideCommit.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../app/page.js', import.meta.url), 'utf8');

test('save-seed continue is not blocked on an unattached download or a stuck slider', () => {
  assert.match(ceremony, /document\.body\.appendChild\(link\)/);
  assert.match(ceremony, /Retry phrase/);
  assert.match(ceremony, /setSlideReset/);
  assert.match(ceremony, /resetKey=\{`\$\{slideReset\}/);
  assert.equal(ceremony.includes('disabled={!words}'), false);
  assert.match(ceremony, /step === 'confirm' && words/);
  assert.doesNotMatch(ceremony, /step !== 'confirm'/);
});

test('slide-to-finish still commits when the track has no width and resets after a failed verify', () => {
  assert.match(slide, /max <= 0 \|\| offsetRef\.current >= max \* 0\.92/);
  assert.match(slide, /window\.addEventListener\('pointerup'/);
  assert.match(slide, /\[resetKey\]/);
});

test('a stored recovery ack is read on the first paint so returning users skip the ceremony', () => {
  assert.match(page, /useState\(\(\) => \{/);
  assert.match(page, /readRecoveryAck\(window\.localStorage, ownerId\)/);
  assert.match(page, /writeRecoveryAck\(localStorage, ownerId\)/);
});
