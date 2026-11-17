import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMicGate } from './mic-gate.mjs';

class FakeTrack {
  constructor() {
    this._enabled = true;
    this.readyState = 'live';
  }

  get enabled() {
    return this._enabled;
  }

  set enabled(value) {
    this._enabled = Boolean(value);
  }

  addEventListener() {}
}

function devicesWith(stream) {
  const devices = {
    getUserMedia() {
      return Promise.resolve(stream);
    },
  };
  return devices;
}

/**
 * Achieves: verifies mute disables the track and ignores a later enable.
 * Fails when: mute disables the track and ignores a later enable breaks (e.g. expected true, false, false).
 * Oracle: assert.equal(track.enabled, true); assert.equal(track.enabled, false); assert.equal(track.enabled, false); assert.equal(track.enabled, true); assert.equal(devices.getUserMedia, native)
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('mute disables the track and ignores a later enable', async () => {
  const track = new FakeTrack();
  const devices = devicesWith({ getAudioTracks: () => [track] });
  const gate = createMicGate();
  const native = devices.getUserMedia;
  gate.arm(devices);
  await devices.getUserMedia({ audio: true });
  assert.equal(track.enabled, true);

  gate.setMuted(true);
  assert.equal(track.enabled, false);
  track.enabled = true;
  assert.equal(track.enabled, false);

  gate.setMuted(false);
  track.enabled = true;
  assert.equal(track.enabled, true);

  gate.disarm();
  assert.equal(devices.getUserMedia, native);
});

/**
 * Achieves: verifies a missing microphone uses a silent input so the call can start.
 * Fails when: a missing microphone uses a silent input so the call can start breaks (e.g. expected silent, true, silent.enabled !== true).
 * Oracle: assert.equal(stream.getAudioTracks()[0], silent); assert.equal(silent.enabled, true)
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('a missing microphone uses a silent input so the call can start', async () => {
  const silent = new FakeTrack();
  const devices = {
    getUserMedia() {
      const error = new Error('Requested device not found');
      error.name = 'NotFoundError';
      return Promise.reject(error);
    },
  };
  const gate = createMicGate({
    silentStream: () => ({ getAudioTracks: () => [silent] }),
  });
  gate.arm(devices);
  const stream = await devices.getUserMedia({ audio: true });
  assert.equal(stream.getAudioTracks()[0], silent);
  assert.equal(silent.enabled, true);
});

/**
 * Achieves: verifies a microphone opened while muted starts disabled.
 * Fails when: a microphone opened while muted starts disabled breaks (e.g. expected false, false, track.enabled !== false).
 * Oracle: assert.equal(track.enabled, false); assert.equal(track.enabled, false)
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('a microphone opened while muted starts disabled', async () => {
  const track = new FakeTrack();
  const devices = devicesWith({ getAudioTracks: () => [track] });
  const gate = createMicGate();
  gate.setMuted(true);
  gate.arm(devices);
  await devices.getUserMedia({ audio: true });
  assert.equal(track.enabled, false);
  track.enabled = true;
  assert.equal(track.enabled, false);
});

/**
 * Achieves: verifies an old call cannot disarm the next call.
 * Fails when: an old call cannot disarm the next call breaks (e.g. expected native).
 * Oracle: assert.equal(second.getUserMedia, native)
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('an old call cannot disarm the next call', () => {
  const gate = createMicGate();
  const first = { getUserMedia() { return Promise.resolve({ getAudioTracks: () => [] }); } };
  const firstGen = gate.arm(first);
  gate.disarm(firstGen);
  const second = { getUserMedia() { return Promise.resolve({ getAudioTracks: () => [] }); } };
  const native = second.getUserMedia;
  gate.arm(second);
  gate.disarm(firstGen);
  assert.notEqual(second.getUserMedia, native);
  gate.disarm();
  assert.equal(second.getUserMedia, native);
});

/**
 * Achieves: verifies enforce puts a re-enabled track back to the mute state.
 * Fails when: enforce puts a re-enabled track back to the mute state breaks (e.g. expected false, track.enabled !== false).
 * Oracle: assert.equal(track.enabled, false)
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('enforce puts a re-enabled track back to the mute state', () => {
  const track = new FakeTrack();
  const gate = createMicGate();
  gate.hold({ getAudioTracks: () => [track] });
  gate.setMuted(true);
  delete track.enabled;
  delete track.__maelstromLock;
  track.enabled = true;
  gate.enforce();
  assert.equal(track.enabled, false);
});
