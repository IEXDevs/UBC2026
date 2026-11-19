import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VAULT_ITERATIONS,
  issueRecovery,
  openRecovery,
  phraseProof,
  readRecoveryState,
  recoveryFailureNote,
  sealRecovery,
  shouldRetryRecovery,
  verifyRecovery,
} from './recovery-vault.mjs';
import { createRecoveryPhrase } from './wallet-desk.mjs';

function reply(body, status = 200) {
  return Promise.resolve(Response.json(body, { status }));
}

/**
 * Achieves: the same phrase comes back from the vault with the right password and never with a wrong one,
 * and the stored payload holds ciphertext and a verifier, not words.
 * Fails when: a wrong password opens the vault, or any phrase word appears in the payload.
 * Oracle: opened words equal the sealed words; payload text contains none of the 12 words.
 * Side effects / state checked: none.
 * Gaps: Account storage is covered by the Worker tests.
 */
test('a sealed phrase opens with its password only and the payload carries no words', async () => {
  const words = await createRecoveryPhrase();
  const sealed = await sealRecovery(words, 'correct horse battery');
  assert.equal(sealed.vault.iterations, VAULT_ITERATIONS);
  assert.deepEqual(await openRecovery(sealed.vault, 'correct horse battery'), words);
  assert.equal(await openRecovery(sealed.vault, 'wrong horse battery'), null);
  assert.equal(await openRecovery({ ...sealed.vault, ct: sealed.vault.ct.replace(/.$/, '0') }, 'correct horse battery'), null);
  const text = JSON.stringify(sealed);
  for (const word of new Set(words)) assert.equal(text.includes(`"${word}"`), false);
  assert.equal(Object.keys(sealed.vault).sort().join(','), 'ct,iterations,iv,salt,v');
  assert.equal(Object.keys(sealed.verifier).sort().join(','), 'hash,iterations,salt');
});

/**
 * Achieves: the verifier proves possession of the exact phrase and nothing else.
 * Fails when: a different phrase produces the same proof, or the proof equals the stored hash for another salt.
 * Oracle: proof equals verifier.hash for the sealed phrase; differs for another phrase and another salt.
 * Side effects / state checked: none.
 * Gaps: none.
 */
test('the phrase proof matches the verifier for the same phrase only', async () => {
  const words = await createRecoveryPhrase();
  const other = await createRecoveryPhrase();
  const sealed = await sealRecovery(words, 'correct horse battery');
  assert.equal(await phraseProof(words, sealed.verifier), sealed.verifier.hash);
  assert.notEqual(await phraseProof(other, sealed.verifier), sealed.verifier.hash);
  assert.notEqual(await phraseProof(words, { salt: '11'.repeat(16) }), sealed.verifier.hash);
  await assert.rejects(phraseProof(['abandon'], sealed.verifier));
});

/**
 * Achieves: the browser reads account seed state, treats an unconfigured store as local mode,
 * and fails closed when the account cannot be reached so no second phrase is made.
 * Fails when: an error reads as "none", or unconfigured is not local.
 * Oracle: state/local/ok fields per fixture.
 * Side effects / state checked: request URL and headers.
 * Gaps: none.
 */
test('seed state reads none, issued, confirmed, local, and unreachable', async () => {
  const seen = [];
  const fetcher = (body, status = 200) => (url, init) => {
    seen.push({ url, init });
    return body instanceof Error ? Promise.reject(body) : reply(body, status);
  };
  const issued = await readRecoveryState(fetcher({ ok: true, state: 'issued', vault: { v: 1 }, verifier: { salt: 'aa', iterations: 1 } }), { ownerId: 'alice', token: 'jwt' });
  assert.equal(issued.state, 'issued');
  assert.deepEqual(issued.vault, { v: 1 });
  assert.equal(seen[0].url, '/api/runtime/api/recovery');
  assert.equal(seen[0].init.headers['x-owner-id'], 'alice');
  assert.equal(seen[0].init.headers.authorization, 'Bearer jwt');
  assert.equal((await readRecoveryState(fetcher({ ok: true, state: 'confirmed' }), { ownerId: 'alice' })).state, 'confirmed');
  assert.equal((await readRecoveryState(fetcher({ ok: true, state: 'none' }), { ownerId: 'alice' })).state, 'none');
  const local = await readRecoveryState(fetcher({ ok: true, source: 'unconfigured', state: 'none' }), { ownerId: 'alice' });
  assert.equal(local.local, true);
  const local503 = await readRecoveryState(fetcher({ ok: false, error: 'runtime_unconfigured', source: 'unconfigured' }, 503), { ownerId: 'alice' });
  assert.equal(local503.ok, true);
  assert.equal(local503.local, true);
  assert.equal((await readRecoveryState(fetcher({ error: 'account_state_unavailable' }, 503), { ownerId: 'alice' })).ok, false);
  assert.equal(shouldRetryRecovery('login_required', 0), true);
  assert.equal(shouldRetryRecovery('login_required', 3), false);
  assert.equal(shouldRetryRecovery('account_state_unavailable', 0), false);
  assert.match(recoveryFailureNote('login_required'), /settling/);
  assert.match(recoveryFailureNote('recovery_unavailable'), /check your seed/);
  assert.equal((await readRecoveryState(fetcher(new Error('offline')), { ownerId: 'alice' })).ok, false);
  assert.equal((await readRecoveryState(fetcher({}), {})).ok, false);
});

/**
 * Achieves: issue reports an existing account seed instead of replacing it, and verify distinguishes a mismatch.
 * Fails when: a 409 reads as success, a 401 reads as a network error, or confirm is dropped from the request.
 * Oracle: result flags and the posted body.
 * Side effects / state checked: posted JSON has proof and confirm only; no words.
 * Gaps: none.
 */
test('issue refuses a second seed and verify separates a mismatch from a failure', async () => {
  const words = await createRecoveryPhrase();
  const sealed = await sealRecovery(words, 'correct horse battery');
  let posted = null;
  const ok = await issueRecovery((url, init) => { posted = JSON.parse(init.body); return reply({ ok: true }); }, { ownerId: 'alice', sealed });
  assert.equal(ok.ok, true);
  assert.deepEqual(Object.keys(posted).sort(), ['vault', 'verifier']);
  const exists = await issueRecovery(() => reply({ error: 'recovery_exists', state: 'confirmed' }, 409), { ownerId: 'alice', sealed });
  assert.deepEqual(exists, { ok: false, exists: true, state: 'confirmed' });
  assert.equal((await issueRecovery(() => reply({ error: 'x' }, 502), { ownerId: 'alice', sealed })).ok, false);

  let proofBody = null;
  const confirmed = await verifyRecovery((url, init) => { proofBody = JSON.parse(init.body); return reply({ ok: true, state: 'confirmed' }); }, {
    ownerId: 'alice', words, verifier: sealed.verifier, confirm: true,
  });
  assert.equal(confirmed.ok, true);
  assert.deepEqual(Object.keys(proofBody).sort(), ['confirm', 'proof']);
  assert.equal(proofBody.proof, sealed.verifier.hash);
  const mismatch = await verifyRecovery(() => reply({ error: 'recovery_mismatch' }, 401), { ownerId: 'alice', words, verifier: sealed.verifier });
  assert.equal(mismatch.mismatch, true);
  const bad = await verifyRecovery(() => reply({}), { ownerId: 'alice', words: ['abandon'], verifier: sealed.verifier });
  assert.equal(bad.error, 'invalid_phrase');
});
