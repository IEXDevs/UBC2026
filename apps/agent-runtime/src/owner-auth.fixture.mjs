import { generateKeyPairSync, sign } from 'node:crypto';
import worker from './index.mjs';
import { testOwnerAuth } from './owner-auth.mjs';

export function privySessionFixture(ownerId, appId = 'testapp1') {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const kid = 'fixture-key';
  const header = encode({ alg: 'ES256', kid });
  const claims = encode({ sub: ownerId, aud: appId, iss: 'privy.io', exp: Math.floor(Date.now() / 1000) + 600 });
  const jwt = `${header}.${claims}`;
  const signature = sign('sha256', Buffer.from(jwt), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return {
    appId,
    token: `${jwt}.${signature.toString('base64url')}`,
    jwksUrl: `https://auth.privy.io/api/v1/apps/${appId}/jwks.json`,
    jwks: () => Response.json({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid }] }),
  };
}

export function withOfflineOwner(env) {
  return { ...env, [testOwnerAuth]: header => /^[a-zA-Z0-9:_-]{1,128}$/.test(header ?? '') ? header : null };
}

export default {
  ...worker,
  fetch: (request, env, ctx) => worker.fetch(request, withOfflineOwner(env), ctx),
};
