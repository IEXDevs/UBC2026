import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedCorsOrigin,
  corsOriginList,
  corsPreflightResponse,
  withCors,
} from './cors.mjs';

test('localhost and configured CORS origins are allowed', () => {
  assert.deepEqual(corsOriginList({}), [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ]);
  assert.ok(corsOriginList({ CORS_ORIGINS: 'https://app.example' }).includes('https://app.example'));

  const local = new Request('https://runtime/api/events', {
    headers: { Origin: 'http://localhost:3000' },
  });
  assert.equal(allowedCorsOrigin(local, {}), 'http://localhost:3000');
  assert.equal(
    allowedCorsOrigin(new Request('https://runtime/api/events', { headers: { Origin: 'https://evil.example' } }), {}),
    null,
  );
});

test('preflight and responses carry CORS headers for localhost', async () => {
  const preflight = new Request('https://runtime/api/events?botId=bot_1', {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:3000',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'x-owner-id',
    },
  });
  const ok = corsPreflightResponse(preflight, {});
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'http://localhost:3000');
  assert.match(ok.headers.get('Access-Control-Allow-Headers') || '', /x-owner-id/i);

  const denied = corsPreflightResponse(new Request('https://runtime/api/events', {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example' },
  }), {});
  assert.equal(denied.status, 403);

  const wrapped = withCors(
    new Request('https://runtime/api/events', { headers: { Origin: 'http://localhost:3000' } }),
    Response.json({ items: [] }, { headers: { 'Cache-Control': 'no-store' } }),
    {},
  );
  assert.equal(wrapped.headers.get('Access-Control-Allow-Origin'), 'http://localhost:3000');
  assert.equal(wrapped.headers.get('Cache-Control'), 'no-store');
});
