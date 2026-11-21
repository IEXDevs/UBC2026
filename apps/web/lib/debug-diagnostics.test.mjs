import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installGlobalDebug } from './debug-diagnostics.mjs';

test('installGlobalDebug hooks target fetch and logs 4xx/5xx responses', async () => {
  const logged = [];
  const fakeConsole = {
    error: (...args) => logged.push(args),
  };
  const originalError = console.error;
  console.error = fakeConsole.error;

  try {
    const fakeTarget = {
      fetch: async (input) => {
        if (input.includes('/ok')) {
          return { ok: true, status: 200, headers: new Map(), clone: () => ({ text: async () => 'ok' }) };
        }
        if (input.includes('/error-json')) {
          const res = {
            ok: false,
            status: 400,
            headers: { get: () => 'application/json' },
            clone: () => res,
            json: async () => ({ error: 'bad_request' }),
          };
          return res;
        }
        throw new Error('network down');
      },
    };

    installGlobalDebug(fakeTarget);

    // Call successful fetch
    await fakeTarget.fetch('https://example.com/ok');
    assert.equal(logged.length, 0);

    // Call failing 400 fetch
    await fakeTarget.fetch('https://example.com/error-json?token=secret123');
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(logged.length, 1);
    assert.match(logged[0][0], /\[fetch error 400\]/);
    assert.match(logged[0][0], /token=(?:\[REDACTED\]|%5BREDACTED%5D)/);
    assert.deepEqual(logged[0][1], { error: 'bad_request' });

    // Call network error fetch
    await assert.rejects(() => fakeTarget.fetch('https://example.com/fail'), /network down/);
    assert.equal(logged.length, 2);
    assert.match(logged[1][0], /\[fetch failure\]/);
  } finally {
    console.error = originalError;
  }
});
