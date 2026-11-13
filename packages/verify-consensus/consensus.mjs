import { createHash } from 'node:crypto';

export class ConsensusError extends Error {}
const fail = message => { throw new ConsensusError(message); };
const MAX_ATTEMPTS = 5;
const required = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const amount = value => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,39})$/.test(value)) fail('Amounts must be unsigned integer strings in base units');
  return value;
};
const score = value => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,2}|1000)$/.test(value) || Number(value) > 1000) fail('Trust score must be an integer string from 0 to 1000');
  return value;
};

/** Canonical trade facts the main agent and verify agent must agree on before any preview reaches the user. */
export function normalizeFacts(facts) {
  if (!facts || !required(facts.asset) || !required(facts.mint) || !required(facts.cluster) || !required(facts.reasonSummary)) fail('Incomplete trade facts');
  if (!['devnet', 'testnet'].includes(facts.cluster)) fail('Hackathon execution must use devnet or testnet');
  if (typeof facts.reasonSummary !== 'string' || facts.reasonSummary.length > 2000) fail('Reasoning summary is required and must stay short');
  return {
    asset: facts.asset,
    mint: facts.mint,
    cluster: facts.cluster,
    price: amount(facts.price),
    amount: amount(facts.amount),
    trustScore: score(facts.trustScore),
    reasonSummary: facts.reasonSummary.trim(),
  };
}

export function factsDigest(facts) {
  return createHash('sha256').update(JSON.stringify(normalizeFacts(facts))).digest('hex');
}

export function compareFacts(main, verified) {
  const a = normalizeFacts(main);
  const b = normalizeFacts(verified);
  const fields = ['asset', 'mint', 'cluster', 'price', 'amount', 'trustScore'];
  const mismatches = fields.filter(field => a[field] !== b[field]);
  return { match: mismatches.length === 0, mismatches, main: a, verified: b };
}

/**
 * Independently re-derive trade facts via `verifyFn` until they match the latest main-agent facts
 * or the five-attempt cap is hit. Silent on match; surfaces only after exhausted disagreement.
 * `mainFn` may revise facts between attempts. Neither function may execute or sign transactions.
 */
export async function reachConsensus({ mainFn, verifyFn, maxAttempts = MAX_ATTEMPTS }) {
  if (typeof mainFn !== 'function' || typeof verifyFn !== 'function') fail('Independent main and verify callables are required');
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_ATTEMPTS) fail(`Verification loop is capped at ${MAX_ATTEMPTS} attempts`);
  const attempts = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const main = normalizeFacts(await mainFn({ attempt, previous: attempts.at(-1) ?? null }));
    const verified = normalizeFacts(await verifyFn({ attempt, main }));
    const comparison = compareFacts(main, verified);
    const record = {
      attempt,
      match: comparison.match,
      mismatches: comparison.mismatches,
      mainDigest: factsDigest(main),
      verifiedDigest: factsDigest(verified),
      main,
      verified,
    };
    attempts.push(record);
    if (comparison.match) {
      return {
        state: 'consensus',
        attempts,
        facts: main,
        digest: record.mainDigest,
        decisionRecord: buildDecisionRecord({ facts: main, attempts, outcome: 'consensus' }),
      };
    }
  }
  return {
    state: 'manual-review',
    attempts,
    facts: null,
    digest: null,
    decisionRecord: buildDecisionRecord({ facts: attempts.at(-1).main, attempts, outcome: 'manual-review' }),
  };
}

export function buildDecisionRecord({ facts, attempts, outcome }) {
  const normalized = normalizeFacts(facts);
  if (!Array.isArray(attempts) || attempts.length < 1) fail('Attempt history is required');
  if (!['consensus', 'manual-review'].includes(outcome)) fail('Invalid decision outcome');
  const payload = {
    version: 1,
    outcome,
    attemptCount: attempts.length,
    mismatches: attempts.flatMap(entry => entry.mismatches.map(field => ({ attempt: entry.attempt, field }))),
    facts: normalized,
    finalDigest: factsDigest(normalized),
  };
  return { ...payload, recordDigest: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
}

/** Compact memo payload for attaching beside a Solana transaction. Not a signature. */
export function memoFromDecision(record) {
  if (!record || !required(record.recordDigest) || !required(record.finalDigest) || !['consensus', 'manual-review'].includes(record.outcome)) fail('Invalid decision record');
  if (record.outcome !== 'consensus') fail('Only consensus decisions may be attached as transaction memos');
  return JSON.stringify({ v: 1, o: 'c', d: record.finalDigest, r: record.recordDigest });
}
