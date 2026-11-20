import { SOLANA_CLUSTER } from '@ubc2026/contracts/solana';
import { createHash } from 'node:crypto';

export class ConsensusError extends Error {}
const fail = message => { throw new ConsensusError(message); };
const MAX_ATTEMPTS = 5;
const required = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const amount = value => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,39})$/.test(value)) fail('Amounts must be unsigned integer strings in base units');
  return value;
};
const score = (value, unavailable = false) => {
  if (unavailable) {
    if (value == null || value === '') return null;
    fail('An unavailable trust score cannot be invented');
  }
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,2}|1000)$/.test(value) || Number(value) > 1000) fail('Trust score must be an integer string from 0 to 1000');
  return value;
};

/** Canonical trade facts the main agent and verify agent must agree on before any preview reaches the user. */
export function normalizeFacts(facts) {
  if (!facts || !required(facts.asset) || !required(facts.mint) || !required(facts.cluster) || !required(facts.reasonSummary)) fail('Incomplete trade facts');
  if (![SOLANA_CLUSTER].includes(facts.cluster)) fail('Execution must use the configured Solana cluster');
  if (typeof facts.reasonSummary !== 'string' || facts.reasonSummary.length > 2000) fail('Reasoning summary is required and must stay short');
  const unavailable = facts.trustUnavailable === true;
  const normalized = {
    asset: facts.asset,
    mint: facts.mint,
    cluster: facts.cluster,
    price: amount(facts.price),
    amount: amount(facts.amount),
    trustScore: score(facts.trustScore, unavailable),
    reasonSummary: facts.reasonSummary.trim(),
  };
  if (unavailable) normalized.trustUnavailable = true;
  return normalized;
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function factsDigest(facts) {
  return sha256Hex(JSON.stringify(normalizeFacts(facts)));
}

function canonicalMismatches(mismatches) {
  if (!Array.isArray(mismatches)) fail('Mismatch history is required');
  return mismatches.map(entry => {
    if (!entry || !Number.isSafeInteger(entry.attempt) || entry.attempt < 1 || entry.attempt > MAX_ATTEMPTS) fail('Invalid mismatch history');
    if (typeof entry.field !== 'string' || entry.field.length < 1 || entry.field.length > 64) fail('Invalid mismatch history');
    return { attempt: entry.attempt, field: entry.field };
  });
}

/** Canonical verifier decision record. The hash binds asset, price, trust score, amount, and the reasoning summary. */
function canonicalDecisionPayload({ facts, attemptCount, mismatches, outcome, version }) {
  const normalized = normalizeFacts(facts);
  if (version !== 1) fail('Unsupported decision record version');
  if (!['consensus', 'manual-review'].includes(outcome)) fail('Invalid decision outcome');
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 1 || attemptCount > MAX_ATTEMPTS) fail('Attempt history is required');
  return {
    version,
    outcome,
    attemptCount,
    mismatches: canonicalMismatches(mismatches),
    facts: normalized,
    finalDigest: factsDigest(normalized),
  };
}

/** SHA-256 of the canonical decision record. A digest is not a signature. */
export function hashDecisionRecord(record) {
  if (!record || typeof record !== 'object') fail('Invalid decision record');
  const payload = canonicalDecisionPayload({
    facts: record.facts,
    attemptCount: record.attemptCount,
    mismatches: record.mismatches,
    outcome: record.outcome,
    version: record.version,
  });
  return { payload, recordDigest: sha256Hex(JSON.stringify(payload)) };
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
  if (!Array.isArray(attempts) || attempts.length < 1) fail('Attempt history is required');
  const mismatches = attempts.flatMap(entry => {
    if (!entry || !Array.isArray(entry.mismatches)) fail('Attempt history is required');
    return entry.mismatches.map(field => ({ attempt: entry.attempt, field }));
  });
  const { payload, recordDigest } = hashDecisionRecord({
    version: 1,
    outcome,
    attemptCount: attempts.length,
    mismatches,
    facts,
  });
  return { ...payload, recordDigest };
}

/**
 * Compact memo string whose `r` field is the SHA-256 of the verifier-approved decision record.
 * Recomputes the digest from the record; a caller-supplied digest that does not match is rejected.
 * Not a signature, and not an on-chain memo submission.
 */
export function memoFromDecision(record) {
  if (!record || !required(record.recordDigest) || !required(record.finalDigest) || !['consensus', 'manual-review'].includes(record.outcome)) fail('Invalid decision record');
  if (record.outcome !== 'consensus') fail('Only consensus decisions may be attached as transaction memos');
  const { payload, recordDigest } = hashDecisionRecord(record);
  if (record.recordDigest !== recordDigest || record.finalDigest !== payload.finalDigest) fail('Decision record digest does not match the hashed record');
  return JSON.stringify({ v: 1, o: 'c', d: payload.finalDigest, r: recordDigest });
}
