import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WALLET_LOGIN_EVENT,
  installSiwsLoginDiagnostic,
  safeSiwsCode,
  siwsPostName,
  walletLoginFailureLine,
} from './siws-login-diagnostic.mjs';

const ADDRESS = 'So11111111111111111111111111111111111111112';
const AUTH = 'https://auth.privy.io/api/v1/siws/authenticate';
const INIT = 'https://auth.privy.io/api/v1/siws/init';

function jsonResponse(status, body, { ok = status < 400 } = {}) {
  const payload = body;
  return {
    ok,
    status,
    clone() {
      return { json: async () => payload };
    },
    json: async () => payload,
  };
}

/**
 * Achieves: verifies only Privy SIWS posts are named.
 * Fails when: only Privy SIWS posts are named breaks (e.g. expected { method: 'POST' }, { method: 'post' }, { method: 'POST' }).
 * Oracle: assert.equal(siwsPostName(AUTH, { method: 'POST' }); assert.equal(siwsPostName(INIT, { method: 'post' }); assert.equal(siwsPostName(`${AUTH}?captcha=secret`, { method: 'POST' }); assert.equal(siwsPostName(AUTH, { method: 'GET' }); assert.equal(siwsPostName('https://auth.privy.io/api/v1/sessions', { method: 'POST' }); assert.equal(siwsPostName('https://example.com/api/v1/siws/authenticate', { method: 'POST' })
 * Side effects / state checked: N/A.
 * Gaps: none.
 */
test('only Privy SIWS posts are named', () => {
  assert.equal(siwsPostName(AUTH, { method: 'POST' }), 'siws/authenticate');
  assert.equal(siwsPostName(INIT, { method: 'post' }), 'siws/init');
  assert.equal(siwsPostName(`${AUTH}?captcha=secret`, { method: 'POST' }), 'siws/authenticate');
  assert.equal(siwsPostName(AUTH, { method: 'GET' }), '');
  assert.equal(siwsPostName('https://auth.privy.io/api/v1/sessions', { method: 'POST' }), '');
  assert.equal(siwsPostName('https://example.com/api/v1/siws/authenticate', { method: 'POST' }), '');
  assert.equal(siwsPostName('/api/v1/siws/authenticate', { method: 'POST' }), '');
  assert.equal(safeSiwsCode({ code: 'invalid_data', error: `Invalid SIWS message for ${ADDRESS}` }), 'invalid_data');
  assert.equal(safeSiwsCode({ error: 'invalid_captcha' }), 'invalid_captcha');
  assert.equal(safeSiwsCode({ error: 'Invalid SIWS message and/or nonce' }), 'siws_failed');
  assert.equal(safeSiwsCode({ code: ADDRESS }), 'siws_failed');
  assert.equal(safeSiwsCode({ code: 'a@b.com' }), 'siws_failed');
  assert.equal(safeSiwsCode({ code: 'header.payload.signature' }), 'siws_failed');
  assert.equal(walletLoginFailureLine('siws/authenticate', 400, 'invalid_data'), '[wallet-login] siws/authenticate 400 invalid_data');
  assert.equal(walletLoginFailureLine('siws/init', 'network', 'siws_failed'), '[wallet-login] siws/init network siws_failed');
});

/**
 * Achieves: verifies a failed SIWS post logs status and a safe code, not the body.
 * Fails when: a failed SIWS post logs status and a safe code, not the body breaks (e.g. expected response, body, ['[wallet-login] siws/authenticate 400 invalid_data']); failure/null paths flip.
 * Oracle: assert.equal(result, response); assert.equal(logged.includes(ADDRESS), false); assert.equal(logged.includes('sig-secret'), false); assert.equal(logged.includes('super-secret'), false); assert.equal(logged.includes('header.payload'), false); assert.equal(logged.includes('Invalid SIWS'), false)
 * Side effects / state checked: fetch/test-double request shapes and responses.
 * Gaps: none.
 */
test('a failed SIWS post logs status and a safe code, not the body', async () => {
  const lines = [];
  const seen = [];
  const body = {
    code: 'invalid_data',
    error: `Invalid SIWS message and/or nonce for ${ADDRESS}`,
    address: ADDRESS,
    token: 'header.payload.signature',
  };
  const response = jsonResponse(400, body);
  const target = {
    fetch: async (input, init) => {
      seen.push({ url: String(input), body: init?.body || '' });
      return response;
    },
  };
  installSiwsLoginDiagnostic(target, (line) => lines.push(line));
  installSiwsLoginDiagnostic(target, () => lines.push('second'));
  const result = await target.fetch(`${AUTH}?captcha=super-secret`, {
    method: 'POST',
    body: JSON.stringify({ message: 'sign me', signature: 'sig-secret', address: ADDRESS }),
  });
  assert.equal(result, response);
  assert.deepEqual(await result.json(), body);
  assert.deepEqual(lines, ['[wallet-login] siws/authenticate 400 invalid_data']);
  const logged = lines.join('\n');
  assert.equal(logged.includes(ADDRESS), false);
  assert.equal(logged.includes('sig-secret'), false);
  assert.equal(logged.includes('super-secret'), false);
  assert.equal(logged.includes('header.payload'), false);
  assert.equal(logged.includes('Invalid SIWS'), false);
});

/**
 * Achieves: verifies siws/init uses the error field when code is absent and safe.
 * Fails when: siws/init uses the error field when code is absent and safe breaks (e.g. expected ['[wallet-login] siws/init 403 disallowed_login_method'], false, lines[0].includes(ADDRESS) !== false).
 * Oracle: assert.equal(lines[0].includes(ADDRESS), false); assert.deepEqual(lines, ['[wallet-login] siws/init 403 disallowed_login_method'])
 * Side effects / state checked: fetch/test-double request shapes and responses.
 * Gaps: none.
 */
test('siws/init uses the error field when code is absent and safe', async () => {
  const lines = [];
  const target = {
    fetch: async () => jsonResponse(403, { error: 'disallowed_login_method', message: `nope ${ADDRESS}` }),
  };
  installSiwsLoginDiagnostic(target, (line) => lines.push(line));
  await target.fetch(INIT, { method: 'POST', body: '{}' });
  assert.deepEqual(lines, ['[wallet-login] siws/init 403 disallowed_login_method']);
  assert.equal(lines[0].includes(ADDRESS), false);
});

/**
 * Achieves: verifies a successful SIWS response is not read.
 * Fails when: a successful SIWS response is not read breaks (e.g. expected true, [], result.ok !== true).
 * Oracle: assert.equal(result.ok, true); assert.deepEqual(lines, [])
 * Side effects / state checked: fetch/test-double request shapes and responses.
 * Gaps: none.
 */
test('a successful SIWS response is not read', async () => {
  const lines = [];
  const target = {
    fetch: async () => ({
      ok: true,
      status: 200,
      clone() {
        throw new Error('read success');
      },
      json() {
        throw new Error('read success');
      },
    }),
  };
  installSiwsLoginDiagnostic(target, (line) => lines.push(line));
  const result = await target.fetch(AUTH, { method: 'POST' });
  assert.equal(result.ok, true);
  assert.deepEqual(lines, []);
});

/**
 * Achieves: verifies other fetches and network failures stay quiet about secrets.
 * Fails when: other fetches and network failures stay quiet about secrets breaks (e.g. expected 401, ['[wallet-login] siws/authenticate network siws_failed'], false).
 * Oracle: assert.equal(other.status, 401); assert.equal(lines[0].includes('header.payload'), false); assert.equal(lines[0].includes('sig-secret'), false); assert.equal(calls.length, 2); assert.deepEqual(lines, ['[wallet-login] siws/authenticate network siws_failed'])
 * Side effects / state checked: fetch/test-double request shapes and responses.
 * Gaps: none.
 */
test('other fetches and network failures stay quiet about secrets', async () => {
  const lines = [];
  const calls = [];
  const target = {
    fetch: async (input) => {
      calls.push(String(input));
      if (String(input).includes('sessions')) {
        return jsonResponse(401, { code: 'missing_or_invalid_token', token: 'header.payload.signature' });
      }
      throw new Error(`Failed to fetch ${AUTH} token=header.payload.signature`);
    },
  };
  installSiwsLoginDiagnostic(target, (line) => lines.push(line));
  const other = await target.fetch('https://auth.privy.io/api/v1/sessions', { method: 'POST' });
  assert.equal(other.status, 401);
  await assert.rejects(() => target.fetch(AUTH, { method: 'POST', body: '{"signature":"sig-secret"}' }));
  assert.deepEqual(lines, ['[wallet-login] siws/authenticate network siws_failed']);
  assert.equal(lines[0].includes('header.payload'), false);
  assert.equal(lines[0].includes('sig-secret'), false);
  assert.equal(calls.length, 2);
});

/**
 * Achieves: verifies a failed SIWS post is announced for the sign-in card.
 * Fails when: a failed SIWS post is announced for the sign-in card breaks (e.g. expected '[wallet-login] siws/authenticate 400 invalid_data', 1).
 * Oracle: assert.equal(events[0].detail, '[wallet-login] siws/authenticate 400 invalid_data')
 * Side effects / state checked: one CustomEvent on the fake window.
 * Gaps: does not render the card.
 */
test('a failed SIWS post is announced for the sign-in card', async () => {
  const events = [];
  const target = {
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
    dispatchEvent(event) {
      events.push(event);
    },
    fetch: async () => jsonResponse(400, { code: 'invalid_data', error: `bad ${ADDRESS}` }),
  };
  installSiwsLoginDiagnostic(target, () => {});
  await target.fetch(AUTH, { method: 'POST' });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, WALLET_LOGIN_EVENT);
  assert.equal(events[0].detail, '[wallet-login] siws/authenticate 400 invalid_data');
  assert.equal(events[0].detail.includes(ADDRESS), false);
});

/**
 * Achieves: verifies PrivyRoot installs the diagnostic and does not touch storage.
 * Fails when: PrivyRoot installs the diagnostic and does not touch storage breaks (e.g. expected /installSiwsLoginDiagnostic/, false, source.includes('localStorage.setItem') !== false).
 * Oracle: assert.equal(source.includes('localStorage.setItem'), false); assert.match(source, /installSiwsLoginDiagnostic/)
 * Side effects / state checked: in-memory storage double writes/reads.
 * Gaps: source snapshot only — runtime UI/HTTP not executed.
 */
test('PrivyRoot installs the diagnostic and does not touch storage', () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../components/PrivyRoot.js'), 'utf8');
  assert.match(source, /installSiwsLoginDiagnostic/);
  assert.equal(source.includes('localStorage.setItem'), false);
});
