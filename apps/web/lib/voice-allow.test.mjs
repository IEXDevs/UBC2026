import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { latestInlineAllow, voiceGrantsAllow } from './voice-allow.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Achieves: a spoken allow accepts a waiting prompt, and other speech does not.
 * Fails when: "allow" is ignored, or a longer sentence is treated as consent.
 * Oracle: short allow phrases are true; questions and refusals are false.
 * Side effects: none.
 * Gaps: does not open a microphone.
 */
test('voice allow is the word allow, not a longer sentence', () => {
  for (const phrase of ['allow', 'Allow.', 'allow it', 'yes allow', 'please allow this', 'okay, allow']) {
    assert.equal(voiceGrantsAllow(phrase), true, phrase);
  }
  for (const phrase of [
    'allow me to check the wallet',
    "don't allow",
    'do not allow',
    'yes',
    'confirm the send',
    'what is my balance',
  ]) {
    assert.equal(voiceGrantsAllow(phrase), false, phrase);
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
 * Achieves: the talk pipe accepts a spoken allow before it sends a chat turn.
 * Fails when: allow is queued as a message, or the desk never offers the hook.
 * Oracle: Composer checks voiceGrantsAllow then onSpokenAllow; the desk confirms slides and inline Allow.
 * Side effects: source files only.
 */
test('the desk accepts a spoken allow for a waiting confirm', () => {
  const composer = readFileSync(join(root, 'components/Composer.js'), 'utf8');
  const page = readFileSync(join(root, 'app/page.js'), 'utf8');
  const commitAt = composer.indexOf('onCommit: (text) =>');
  const sendAt = composer.indexOf('void sendMessage(text)', commitAt);
  assert.ok(commitAt > 0 && sendAt > commitAt);
  assert.match(composer.slice(commitAt, sendAt), /voiceGrantsAllow\(text\)/);
  assert.match(composer.slice(commitAt, sendAt), /onSpokenAllowRef\.current\?\.\(\) === true/);
  assert.match(page, /onSpokenAllow=\{acceptSpokenAllow\}/);
  assert.match(page, /finishSlideConfirm\(true\)/);
  assert.match(page, /latestInlineAllow\(/);
  assert.match(page, /Say allow to confirm/);
  assert.match(page, /onVoiceLive=\{setVoiceLive\}/);
  assert.match(page, /slideConfirm && !voiceLive/);
  assert.match(page, /pendingSend && !voiceLive/);
  assert.match(page, /hideAccessActions=\{voiceLive\}/);
  const bubbles = readFileSync(join(root, 'components/ChatBubbles.js'), 'utf8');
  assert.match(bubbles, /hideAccessActions \? null/);
  assert.match(composer, /hideAccessActions/);
  assert.match(composer, /function sayAllow/);
});
