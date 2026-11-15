import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  dictationBusyError,
  dictationUnsupportedError,
  speechRecognitionCtor,
  startBrowserDictation,
} from './dictation.mjs';

test('speechRecognitionCtor reads standard and webkit constructors', () => {
  assert.equal(speechRecognitionCtor({}), null);
  const Speech = function Speech() {};
  assert.equal(speechRecognitionCtor({ SpeechRecognition: Speech }), Speech);
  assert.equal(speechRecognitionCtor({ webkitSpeechRecognition: Speech }), Speech);
});

test('startBrowserDictation rejects when recognition is unavailable', async () => {
  await assert.rejects(
    () => startBrowserDictation({ Recognition: null }),
    (error) => error.code === 'unsupported',
  );
  assert.equal(dictationUnsupportedError().code, 'unsupported');
  assert.equal(dictationBusyError().code, 'voice_live');
});

test('startBrowserDictation resolves the final transcript and supports cancel', async () => {
  let instance = null;
  function FakeRecognition() {
    instance = this;
    this.lang = '';
    this.interimResults = false;
    this.continuous = true;
    this.start = () => {};
    this.stop = () => {
      this.onend?.();
    };
  }
  const job = startBrowserDictation({ Recognition: FakeRecognition });
  assert.equal(instance.lang, 'en-US');
  assert.equal(instance.interimResults, true);
  assert.equal(instance.continuous, false);
  instance.onresult?.({
    results: [
      { 0: { transcript: 'hello ' }, isFinal: false },
      { 0: { transcript: 'world' }, isFinal: true },
    ],
  });
  instance.onend?.();
  assert.equal(await job, 'hello world');

  const cancelled = startBrowserDictation({ Recognition: FakeRecognition });
  cancelled.cancel();
  assert.equal(await cancelled, '');
});
