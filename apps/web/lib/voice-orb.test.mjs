import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatOrbLook, orbSpeed, voiceOrbLook } from './voice-orb.mjs';

test('one orb covers chat work and who is talking', () => {
  assert.deepEqual(chatOrbLook('think'), { state: 'reasoning', variant: 'default', label: 'Thinking' });
  assert.equal(chatOrbLook('search').state, 'searching');
  assert.equal(chatOrbLook('browser').state, 'using');
  assert.equal(chatOrbLook('tool').state, 'working');
  assert.equal(voiceOrbLook('agent').state, 'reasoning');
  assert.equal(voiceOrbLook('user').variant, 'record');
  assert.equal(voiceOrbLook('idle').state, 'idle');
  assert.equal(orbSpeed(0), 0.75);
  assert.equal(orbSpeed(1), 2.25);
  assert.equal(orbSpeed(4), 2.25);
});
