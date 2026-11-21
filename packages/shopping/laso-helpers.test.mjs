import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LASO_DOCS_VERSION_URL, LASO_REFERENCES, LASO_SKILL_URL, lasoDocsFor } from './laso-docs.mjs';
import {
  closeLasoFlow,
  flowIsOpen,
  lasoWaitingPrompt,
  publicLasoFlow,
  resumeLasoFlow,
  startLasoFlow,
  updateLasoFlow,
} from './laso-flow.mjs';

test('docs resolve by topic with the skill first and a version beacon', () => {
  assert.equal(lasoDocsFor('what is a reloadable card').docs[0], LASO_SKILL_URL);
  assert.ok(lasoDocsFor('what is a reloadable card').docs.includes(LASO_REFERENCES.cards));
  assert.ok(lasoDocsFor('buy a $50 amazon gift card').docs.includes(LASO_REFERENCES.giftCards));
  assert.ok(lasoDocsFor('send venmo to Jane').docs.includes(LASO_REFERENCES.payouts));
  assert.ok(lasoDocsFor('check my kyc status').docs.includes(LASO_REFERENCES.account));
  assert.ok(lasoDocsFor('top up the balance').docs.includes(LASO_REFERENCES.payments));
  assert.equal(lasoDocsFor('hello').versionUrl, LASO_DOCS_VERSION_URL);
});

test('flows start open, wait on the owner, and resume from the stage', () => {
  const flow = startLasoFlow({ kind: 'reloadable', amountUsd: 25, now: 1000 });
  assert.equal(flow.stage, 'quoted');
  assert.equal(flowIsOpen(flow), true);
  assert.match(lasoWaitingPrompt(flow), /Reply done/);
  assert.match(lasoWaitingPrompt(startLasoFlow({ kind: 'undecided', now: 1000 })), /Reloadable or non-reloadable USA/);
  assert.equal(resumeLasoFlow(flow, 'done, I finished the code step').decision, 'verify-now');
  assert.equal(resumeLasoFlow(flow, 'hang on, still doing it').decision, 'keep-waiting');
  assert.equal(resumeLasoFlow(flow, 'cancel that, I want a gift card').decision, 'restart');
  const moved = updateLasoFlow(flow, { stage: 'waiting-owner', card_id: 'card_123', now: 2000 });
  assert.deepEqual(publicLasoFlow(moved), {
    kind: 'reloadable', stage: 'waiting-owner', amountUsd: 25, card_id: 'card_123', updatedAt: 2000,
  });
  assert.equal(closeLasoFlow(moved, { now: 3000 }).stage, 'done');
  assert.equal(flowIsOpen(closeLasoFlow(moved, { ok: false, now: 3000 })), false);
  assert.equal(flowIsOpen(null), false);
});

test('flows reject secrets-shaped input and closed transitions', () => {
  assert.throws(() => startLasoFlow({ kind: 'reloadable', now: 1000, card_id: 'has space' }), /invalid_card/);
  assert.throws(() => startLasoFlow({ kind: 'prepaid', now: 1000 }), /invalid_kind/);
  assert.throws(() => updateLasoFlow(startLasoFlow({ kind: 'gift', now: 1000 }), { stage: 'done', now: 1000 }), /invalid_stage/);
  const done = closeLasoFlow(startLasoFlow({ kind: 'gift', now: 1000 }), { now: 1000 });
  assert.throws(() => updateLasoFlow(done, { stage: 'paid', now: 1000 }), /flow_closed/);
  assert.equal(publicLasoFlow({ v: 1, kind: 'gift', stage: 'paid', pan: '4111', id_token: 'x' }).pan, undefined);
});
