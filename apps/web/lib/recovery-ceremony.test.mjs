import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ceremony = readFileSync(new URL('../components/RecoveryCeremony.js', import.meta.url), 'utf8');
const acceptance = readFileSync(new URL('../components/SpendAcceptance.js', import.meta.url), 'utf8');
const slide = readFileSync(new URL('../components/bits/SlideCommit.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../app/page.js', import.meta.url), 'utf8');

/**
 * Achieves: the spend sheet writes the mode and the USDC maximum before it says they were saved.
 * Fails when: Continue only starts a timer, a failed write still says Saved, or a remount drops the typed amount.
 * Oracle: writeAcceptance runs, the read-back must be true, and the draft is written on each edit.
 * Side effects / state checked: source of the onboarding sheet and the desk page.
 * Gaps: none.
 */
test('the review maximum is stored before the sheet says it saved', () => {
  assert.match(page, /writeAcceptance\(accountStorage, ownerId, \{ permission, reviewCap \}\)/);
  assert.match(page, /readAcceptanceAck\(localStorage, ownerId\) !== true/);
  assert.match(page, /flushAccountState\(\)/);
  assert.match(acceptance, /That maximum did not save/);
  assert.match(acceptance, /writeAcceptanceDraft\(sessionStorage, ownerId/);
  assert.doesNotMatch(acceptance, /setTimeout/);
  assert.match(ceremony, /onDone\?\.\(\)/);
  assert.match(page, /writeRecoveryAck\(localStorage, ownerId\)/);
  assert.match(page, /setRecoveryAck\(true\)/);
});

test('slide-to-finish still commits when the track has no width and resets after a failed verify', () => {
  assert.match(slide, /max <= 0 \|\| offsetRef\.current >= max \* 0\.92/);
  assert.match(slide, /window\.addEventListener\('pointerup'/);
  assert.match(slide, /\[resetKey\]/);
  assert.match(slide, /setPointerCapture\(event\.pointerId\)/);
  assert.match(slide, /Capture is optional/);
});
