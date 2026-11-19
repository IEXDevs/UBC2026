import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { copyText } from './copy-text.mjs';

test('copyText uses the clipboard API when writeText succeeds', async () => {
  const calls = [];
  const ok = await copyText('secret-phrase', {
    navigator: {
      clipboard: {
        writeText: async (value) => { calls.push(value); },
      },
    },
    document: { body: {}, createElement() { throw new Error('fallback'); } },
  });
  assert.equal(ok, true);
  assert.deepEqual(calls, ['secret-phrase']);
  assert.equal(await copyText(''), false);
  assert.equal(await copyText(null), false);
});

test('copyText falls back to execCommand when clipboard write is denied', async () => {
  const removed = [];
  const node = {
    value: '',
    style: {},
    setAttribute() {},
    focus() {},
    select() {},
    setSelectionRange() {},
    remove() { removed.push(true); },
  };
  const io = {
    navigator: {
      clipboard: {
        writeText: async () => { throw new Error('NotAllowedError'); },
      },
    },
    document: {
      body: { appendChild(item) { this.child = item; } },
      createElement(tag) {
        assert.equal(tag, 'textarea');
        return node;
      },
      execCommand(command) {
        assert.equal(command, 'copy');
        return true;
      },
    },
  };
  assert.equal(await copyText('four word pass phrase', io), true);
  assert.equal(node.value, 'four word pass phrase');
  assert.equal(node.style.left, '0');
  assert.equal(node.style.top, '0');
  assert.equal(removed.length, 1);
});

test('SecretDraft and AddressCopy copy through copyText', () => {
  const draft = readFileSync(new URL('../components/SecretDraft.js', import.meta.url), 'utf8');
  const address = readFileSync(new URL('../components/AddressCopy.js', import.meta.url), 'utf8');
  assert.match(draft, /copyText/);
  assert.match(draft, /onCopy=/);
  assert.match(address, /copyText/);
  assert.equal(draft.includes('navigator.clipboard.writeText'), false);
});
