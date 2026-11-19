import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { latestInlineAllow, voiceConfirmDecision } from './voice-allow.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Achieves: a spoken yes or a sentence that contains one allows a waiting prompt.
 * Fails when: "yes", "go ahead", or "yeah, send it" is ignored.
 * Oracle: those phrases are allow; a balance question is null.
 * Side effects: none.
 * Gaps: does not open a microphone.
 */
test('a sentence that affirms allows a waiting prompt', () => {
  for (const phrase of [
    'allow',
    'Allow.',
    'yes',
    'yeah',
    'sure',
    'okay',
    'go ahead',
    'confirm the send',
    'yes, send it',
    'yeah that sounds good',
    'no problem, go ahead',
    'allow me to move that',
  ]) {
    assert.equal(voiceConfirmDecision(phrase), 'allow', phrase);
  }
  assert.equal(voiceConfirmDecision('what is my balance'), null);
  assert.equal(voiceConfirmDecision('check the wallet'), null);
});

/**
 * Achieves: a spoken no or a sentence that contains one denies a waiting prompt.
 * Fails when: "no", "don't", or "yes but don't" allows the spend.
 * Oracle: those phrases are deny, and a refusal beats an affirmation.
 * Side effects: none.
 */
test('a sentence that refuses denies a waiting prompt', () => {
  for (const phrase of [
    'no',
    'nope',
    "don't",
    'do not allow',
    "don't allow",
    'cancel that',
    'not now',
    'no thanks',
    'yeah, but do not send it',
    "I'm not sure",
  ]) {
    assert.equal(voiceConfirmDecision(phrase), 'deny', phrase);
  }
});

/**
 * Achieves: only the latest unanswered inline Allow can be spoken.
 * Fails when: an older request or a request after a newer reply is accepted.
 * Oracle: the access line is returned, then null after a user or agent line.
 * Side effects: none.
 */
test('latest inline allow is the waiting wallet or access prompt', () => {
  const ask = { id: 'a', role: 'agent', text: 'Read wallet balances', access: { kind: 'inline', name: 'get_wallets' } };
  assert.equal(latestInlineAllow([
    { id: 'u', role: 'user', text: 'check my wallets' },
    ask,
  ]), ask);
  assert.equal(latestInlineAllow([ask, { id: 'n', role: 'note', text: 'Still waiting.' }]), ask);
  assert.equal(latestInlineAllow([ask, { id: 'u2', role: 'user', text: 'allow' }]), null);
  assert.equal(latestInlineAllow([
    ask,
    { id: 'b', role: 'agent', text: 'Balances are on the desk.' },
  ]), null);
});

/**
 * Achieves: the talk pipe accepts a spoken yes or no before it sends a chat turn.
 * Fails when: the decision is queued as a message, or a denial cannot cancel.
 * Oracle: Composer passes voiceConfirmDecision to the desk, which allows and denies.
 * Side effects: source files only.
 */
test('the desk accepts a spoken yes or no for a waiting confirm', () => {
  const composer = readFileSync(join(root, 'components/Composer.js'), 'utf8');
  const page = readFileSync(join(root, 'app/page.js'), 'utf8');
  const commitAt = composer.indexOf('onCommit: (text) =>');
  const sendAt = composer.indexOf('void sendMessage(text)', commitAt);
  assert.ok(commitAt > 0 && sendAt > commitAt);
  assert.match(composer.slice(commitAt, sendAt), /voiceConfirmDecision\(text\)/);
  assert.match(composer.slice(commitAt, sendAt), /onSpokenConfirmRef\.current\?\.\(decision\) === true/);
  assert.match(page, /onSpokenConfirm=\{acceptSpokenConfirm\}/);
  assert.match(page, /finishSlideConfirm\(accepted\)/);
  assert.match(page, /The send stayed unsent/);
  assert.match(page, /latestInlineAllow\(/);
  assert.match(page, /Say yes to confirm, or no to cancel/);
  assert.match(page, /onVoiceLive=\{setVoiceLive\}/);
  assert.match(page, /slideConfirm && !voiceLive/);
  assert.match(page, /pendingSend && !voiceLive/);
  assert.match(page, /hideAccessActions=\{voiceLive\}/);
  const bubbles = readFileSync(join(root, 'components/ChatBubbles.js'), 'utf8');
  assert.match(bubbles, /hideAccessActions \? null/);
  assert.match(composer, /hideAccessActions/);
  assert.match(composer, /function sayConfirm/);
});
