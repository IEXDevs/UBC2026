/**
 * Checkpointed bot loop:
 * research → decide → trust gate → verify → bot-policy → approval → execute → memo → monitor.
 * Each completed or waiting step is persisted before the next one starts.
 * Signing goes through an injected devnet transfer client. This module does not call x402.
 */
import { approvalRequirement } from '@ubc2026/agent-loop';
import { assetByMint, createPaperBook, openPaperPosition } from '@ubc2026/paper-positions';
import { readJupiterSwapQuote, usdPriceBaseUnits } from '@ubc2026/prices';
import { evaluateProposal, validateApproval } from '@ubc2026/bot-policy';
import { evaluateTrust } from '@ubc2026/trust-score';
import { transferDevnetUsdc } from '@ubc2026/transfers';
import { memoFromDecision, normalizeFacts, reachConsensus } from '@ubc2026/verify-consensus';
import { parseTurnVerdict, turnVerifyTask } from '@ubc2026/verify-consensus/turn';
import { assertSpendAllowed } from '@ubc2026/wallets';
import { advanceRun, pauseRun, resumeRun } from './checkpoint.mjs';

export class LoopEngineError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = 'LoopEngineError';
    this.code = code;
    this.status = status;
  }
}

export const LOOP_STEPS = Object.freeze([
  'research',
  'decide',
  'trust-gate',
  'verify',
  'policy',
  'approval',
  'execute',
  'memo',
  'monitor',
]);

const SPEND_STEPS = new Set(['research', 'decide', 'trust-gate', 'verify', 'policy', 'approval', 'execute']);
const APPROVAL_RETRY = new Set(['approval-needed', 'budget-override-required', 'invalid-approval']);

function clip(value, max = 2000) {
  const text = typeof value === 'string' ? value : '';
  return text.length > max ? text.slice(0, max) : text;
}

function redact(value, secrets) {
  let text = typeof value === 'string' ? value : '';
  for (const secret of secrets ?? []) {
    if (typeof secret === 'string' && secret.length >= 8) text = text.split(secret).join('[redacted]');
  }
  return text;
}

function nextLoopStep(step) {
  const index = LOOP_STEPS.indexOf(step);
  if (index < 0) throw new LoopEngineError('unknown_step', 409);
  return LOOP_STEPS[index + 1] ?? null;
}

function withCheckpoint(run, step, checkpoint) {
  return {
    ...run,
    checkpoints: {
      ...(run.checkpoints ?? {}),
      [step]: checkpoint,
    },
  };
}

function finishStep(run, step, checkpoint, now) {
  return withCheckpoint(run, step, { at: now, ...checkpoint, status: 'done' });
}

function waitStep(run, step, reason, checkpoint, now) {
  const next = withCheckpoint(run, step, { at: now, ...checkpoint, status: 'waiting', reason });
  if (next.paused && next.pauseReason === reason) return next;
  return pauseRun(next, reason, now);
}

function spendBlock(bot, wallet) {
  try {
    assertSpendAllowed({ bot, wallet });
    if (wallet.ownerId !== bot.ownerId) return 'owner-mismatch';
    return null;
  } catch (error) {
    return error?.message || 'spend-frozen';
  }
}

function extractJson(text) {
  if (typeof text !== 'string') return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function asAmount(value) {
  return typeof value === 'string' && /^(0|[1-9][0-9]{0,39})$/.test(value) ? value : null;
}

const SWAP_MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function readSwap(raw) {
  const swap = raw?.swap;
  if (!swap || typeof swap !== 'object') return null;
  const inputMint = typeof swap.inputMint === 'string' ? swap.inputMint.trim() : '';
  const outputMint = typeof swap.outputMint === 'string' ? swap.outputMint.trim() : '';
  const inAmount = asAmount(swap.inAmount);
  if (!SWAP_MINT.test(inputMint) || !SWAP_MINT.test(outputMint) || inputMint === outputMint) return null;
  if (!inAmount || inAmount === '0') return null;
  if (!assetByMint(inputMint) || !assetByMint(outputMint)) return null;
  return { inputMint, outputMint, inAmount };
}

function proposalFrom(raw, bot, run) {
  if (!raw || typeof raw !== 'object') return null;
  const cluster = raw.cluster == null ? 'devnet' : raw.cluster;
  if (cluster !== 'devnet' && cluster !== 'testnet') return { rejectedCluster: String(cluster).slice(0, 32) };
  if (raw.asset !== bot.cap?.asset) return { assetMismatch: true };
  const outflow = asAmount(raw.outflow);
  const expectedReceive = asAmount(raw.expectedReceive);
  const maxFee = asAmount(raw.maxFee);
  if (!outflow || outflow === '0' || !expectedReceive || !maxFee) return null;
  if (typeof raw.recipient !== 'string' || raw.recipient.length < 32 || raw.recipient.length > 64) return null;
  if (!Number.isSafeInteger(raw.expiresAt) || raw.expiresAt <= 0) return null;
  const id = typeof raw.id === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(raw.id) ? raw.id : `p_${run.runId}`;
  const quoteId = typeof raw.quoteId === 'string' && quoteIdOk(raw.quoteId) ? raw.quoteId : `q_${run.runId}`;
  const expectedReceiveAsset = typeof raw.expectedReceiveAsset === 'string' && raw.expectedReceiveAsset.length <= 64
    ? raw.expectedReceiveAsset
    : raw.asset;
  const swap = readSwap(raw);
  return {
    proposal: {
      id,
      botId: bot.id,
      cluster,
      asset: raw.asset,
      recipient: raw.recipient,
      quoteId,
      outflow,
      expectedReceive,
      expectedReceiveAsset,
      maxFee,
      expiresAt: raw.expiresAt,
      ...(swap ? { swap } : {}),
    },
  };
}

function quoteIdOk(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

function factsFrom(raw) {
  try {
    return normalizeFacts(raw);
  } catch {
    return null;
  }
}

function slimSource(source) {
  if (!source || typeof source !== 'object') return null;
  return {
    title: clip(source.title, 200),
    url: clip(source.url, 500),
    snippet: clip(source.snippet, 300),
  };
}

function slimPolicy(policy) {
  return {
    state: policy.state,
    reason: policy.reason ?? null,
    violations: policy.violations ?? [],
    actions: policy.actions ?? [],
    digest: policy.digest ?? null,
    debit: policy.debit ?? null,
  };
}

function goalFor(run, bot) {
  return run.goal || bot.goal || '';
}

/** Trading goals, including a long-term inflation goal, must leave decide with a proposal. */
export function isTradingGoal(goal, bot) {
  if (bot?.type === 'trading') return true;
  const text = `${goal || ''}`.toLowerCase();
  return /\b(trad(?:e|ing)|inflation)\b/.test(text);
}

/** Full permission continues. Ask is not an override of a fully-automatic bot. */
function trustedOwnerPermission(input) {
  const value = input?.ownerPermission;
  if (value === 'full' || value === 'review') return value;
  return undefined;
}

function approvalOptions(input) {
  const ownerPermission = trustedOwnerPermission(input);
  if (!ownerPermission) return {};
  return {
    ownerPermission,
    confirmed: input?.confirmed === true,
    reviewCap: typeof input?.reviewCap === 'string' ? input.reviewCap : undefined,
  };
}

export function decideTask(goal, bot) {
  const lines = [
    'Role: decide',
    'Return JSON only with summary, facts, and proposal.',
    'facts fields: asset, mint, cluster, price, amount, trustScore, reasonSummary.',
    'When a Jupiter trust lookup is configured, the platform replaces trustScore with the Jupiter Tokens API v2 score before the trust gate. A model-invented score does not pass that gate.',
    'When a mainnet price lookup is configured, the platform replaces price with that paper quote before verify. A price quote does not sign, broadcast, or authorize a transaction.',
    'proposal fields: asset, recipient, outflow, expectedReceive, expectedReceiveAsset, maxFee, expiresAt, cluster.',
    'cluster must be devnet or testnet. Amounts are integer strings in base units.',
    'Do not invent an API key or a signature.',
  ];
  if (isTradingGoal(goal, bot)) {
    lines.push(
      'The goal is trading. Long-term trading to beat USD inflation is in scope.',
      'Propose one concrete Solana devnet trade in proposal. Do not stop after a summary.',
      'Use the bot cap asset and the assigned wallet. cluster is devnet or testnet only.',
      'Do not propose mainnet, a meme coin, or a day trade. Do not sign or broadcast.',
      'For that one trade, include swap with inputMint, outputMint, and inAmount.',
      'inputMint and outputMint are wrapped SOL, USDC, or USDT. inAmount is base units of inputMint.',
      'A move of SOL into USDC uses wrapped SOL as inputMint and USDC as outputMint.',
      'Do not include a swap transaction. The platform quotes Jupiter, signs on devnet only, and marks the paper position from the mainnet price.',
      'The platform gate still blocks a failed trust check, a failed verify, a policy or cap block, and any non-devnet trade.',
    );
  }
  return lines.join('\n');
}

function resolvePause(run, ctx) {
  if (!run.paused) return run;
  if (APPROVAL_RETRY.has(run.pauseReason) && ctx.input.approval) return resumeRun(run, ctx.now);
  if (run.pauseReason === 'trust-confirmation' && ctx.input.trustConfirmed === true) {
    return resumeRun({ ...run, trustConfirmed: true }, ctx.now);
  }
  if (run.pauseReason === 'signer-not-configured' && (ctx.deps.transferClient || typeof ctx.deps.execute === 'function')) {
    return resumeRun(run, ctx.now);
  }
  if (run.pauseReason === 'decide-invalid' && ctx.input.proposal && ctx.input.facts) {
    const checkpoints = { ...(run.checkpoints ?? {}) };
    delete checkpoints.decide;
    return resumeRun({ ...run, checkpoints }, ctx.now);
  }
  return run;
}

async function acceptTurn(ctx, kind, detail) {
  const completion = await ctx.models.complete({
    role: 'verify',
    goal: ctx.bot?.goal || '',
    task: turnVerifyTask(kind, detail),
  });
  return parseTurnVerdict(completion.text).allow;
}

async function performResearch(run, ctx) {
  let sources = Array.isArray(ctx.input.research?.sources) ? ctx.input.research.sources : [];
  let searchNote = null;
  if (!ctx.input.research?.sources && typeof ctx.deps.search === 'function') {
    try {
      const found = await ctx.deps.search(clip(redact(goalFor(run, ctx.bot), ctx.deps.secrets), 1000), 5);
      sources = Array.isArray(found) ? found : [];
    } catch (error) {
      if (error?.code === 'search_not_configured' || error?.code === 'provider_unavailable') searchNote = error.code;
      else return waitStep(run, 'research', 'research-failed', { detail: error?.code ?? 'search-failed' }, ctx.now);
    }
  }
  const slim = sources.map(slimSource).filter(Boolean).slice(0, 5);
  let summary = typeof ctx.input.research?.summary === 'string' ? ctx.input.research.summary : '';
  let model = null;
  const images = Array.isArray(ctx.input.images) ? ctx.input.images : [];
  if (!summary.trim()) {
    const completion = await ctx.models.complete({
      role: images.length ? 'vision' : 'research',
      goal: goalFor(run, ctx.bot),
      task: 'Role: research\nSummarize research for this goal. Do not propose a transaction.',
      untrusted: slim.map(source => ({
        role: 'user',
        content: `Untrusted source: ${source.title} ${source.url}\n${source.snippet}`,
      })),
      images,
    });
    summary = completion.text;
    model = completion.model;
  }
  if (!(await acceptTurn(ctx, 'research', summary))) {
    return waitStep(run, 'research', 'verifier-blocked', { model }, ctx.now);
  }
  return finishStep(run, 'research', { summary: clip(summary), sources: slim, model, searchNote }, ctx.now);
}

async function performDecide(run, ctx) {
  const research = run.checkpoints?.research;
  let summary = '';
  let model = null;
  let rawFacts;
  let rawProposal;
  if (ctx.input.proposal && ctx.input.facts) {
    summary = typeof ctx.input.summary === 'string' ? ctx.input.summary : 'supplied';
    rawFacts = ctx.input.facts;
    rawProposal = ctx.input.proposal;
  } else {
    const completion = await ctx.models.complete({
      role: 'decide',
      goal: goalFor(run, ctx.bot),
      task: decideTask(goalFor(run, ctx.bot), ctx.bot),
      untrusted: [{ role: 'user', content: `Untrusted research summary:\n${clip(research?.summary ?? '', 2000)}` }],
    });
    model = completion.model;
    const parsed = extractJson(completion.text);
    if (!parsed) return waitStep(run, 'decide', 'decide-invalid', { model }, ctx.now);
    summary = typeof parsed.summary === 'string' ? parsed.summary : clip(completion.text, 500);
    rawFacts = parsed.facts;
    rawProposal = parsed.proposal;
  }
  const built = proposalFrom(rawProposal, ctx.bot, run);
  if (!built) return waitStep(run, 'decide', 'decide-invalid', { model }, ctx.now);
  if (built.rejectedCluster) return waitStep(run, 'decide', 'cluster-rejected', { cluster: built.rejectedCluster, model }, ctx.now);
  if (built.assetMismatch) return waitStep(run, 'decide', 'accounting-asset-mismatch', { model }, ctx.now);
  const facts = factsFrom(rawFacts);
  if (!facts) return waitStep(run, 'decide', 'decide-invalid', { model }, ctx.now);
  if (facts.amount !== built.proposal.outflow || facts.cluster !== built.proposal.cluster || facts.asset !== built.proposal.asset) {
    return waitStep(run, 'decide', 'amount-mismatch', { model }, ctx.now);
  }
  const looked = await requestJupiterTrust(facts, ctx);
  if (looked?.error) return waitStep(run, 'decide', looked.error, { model }, ctx.now);
  if (looked?.score) facts.trustScore = looked.score;
  if (!(await acceptTurn(ctx, 'decide', summary))) {
    return waitStep(run, 'decide', 'verifier-blocked', { model }, ctx.now);
  }
  return finishStep(run, 'decide', {
    summary: clip(summary, 500),
    proposal: built.proposal,
    facts,
    model,
    ...(looked?.score ? { trust: { score: looked.score, source: looked.source } } : {}),
  }, ctx.now);
}

function readLookupScore(looked) {
  if (typeof looked === 'string' || typeof looked === 'number') return String(looked);
  if (looked && (typeof looked.score === 'string' || typeof looked.score === 'number')) return String(looked.score);
  return null;
}

/** Request a Jupiter trust score while deciding. Null when no lookup is configured. */
async function requestJupiterTrust(facts, ctx) {
  if (typeof ctx.deps.trustLookup !== 'function') return null;
  try {
    const looked = await ctx.deps.trustLookup(facts.mint);
    const score = readLookupScore(looked);
    if (!score) return { error: 'trust-unavailable' };
    const source = looked && typeof looked === 'object' && typeof looked.source === 'string'
      ? looked.source
      : 'jupiter-tokens-v2';
    return { score, source };
  } catch {
    return { error: 'trust-unavailable' };
  }
}

async function performTrust(run, ctx) {
  const facts = run.checkpoints.decide.facts;
  const recorded = run.checkpoints.decide.trust;
  let score = recorded?.score ?? null;
  if (score == null) score = ctx.input.trustScore;
  if (score == null && typeof ctx.deps.trustLookup === 'function') {
    const looked = await requestJupiterTrust(facts, ctx);
    if (looked?.error) return waitStep(run, 'trust-gate', looked.error, {}, ctx.now);
    score = looked?.score ?? null;
  }
  if (score == null) return waitStep(run, 'trust-gate', 'trust-not-configured', {}, ctx.now);
  let trust;
  try {
    trust = evaluateTrust({
      score,
      confirmed: ctx.input.trustConfirmed === true || run.trustConfirmed === true,
    });
  } catch {
    return waitStep(run, 'trust-gate', 'trust-invalid', {}, ctx.now);
  }
  if (trust.state === 'confirmation-required') {
    return waitStep(run, 'trust-gate', 'trust-confirmation', { trust }, ctx.now);
  }
  return finishStep(run, 'trust-gate', { trust }, ctx.now);
}

function integerPrice(quote) {
  if (typeof quote === 'string' && /^(?:[1-9][0-9]{0,39})$/.test(quote)) return quote;
  if (quote && typeof quote.price === 'string' && /^(?:[1-9][0-9]{0,39})$/.test(quote.price)) return quote.price;
  if (quote && typeof quote.priceUsd === 'string') {
    try { return usdPriceBaseUnits(quote.priceUsd); } catch { return null; }
  }
  return null;
}

function publicQuote(quote) {
  if (!quote || typeof quote !== 'object') return null;
  return {
    mint: typeof quote.mint === 'string' ? quote.mint : null,
    priceUsd: typeof quote.priceUsd === 'string' ? quote.priceUsd : null,
    quoteSource: typeof quote.quoteSource === 'string' ? quote.quoteSource.slice(0, 64) : null,
    pricingCluster: 'mainnet',
    executionCluster: 'devnet',
    label: quote.label === 'devnet execution, mainnet pricing' ? quote.label : 'devnet execution, mainnet pricing',
    paperPnl: true,
    authorizesTransaction: false,
  };
}

async function quotedPrice(facts, ctx) {
  if (typeof ctx.deps.lookupPrice !== 'function') return null;
  try {
    const quote = await ctx.deps.lookupPrice(facts.mint);
    const price = integerPrice(quote);
    if (!price) return { error: 'price_unavailable' };
    return { price, quote: publicQuote(quote) };
  } catch (error) {
    return { error: typeof error?.code === 'string' ? error.code : 'price_unavailable' };
  }
}

async function verifyFromProviders(facts, ctx) {
  const next = { ...facts };
  if (typeof ctx.deps.lookupPrice === 'function') {
    const priced = await quotedPrice(facts, ctx);
    if (priced?.error) throw new LoopEngineError(priced.error, 422);
    if (priced) next.price = priced.price;
  }
  if (typeof ctx.deps.trustLookup === 'function') {
    const looked = await ctx.deps.trustLookup(facts.mint);
    next.trustScore = typeof looked === 'string' ? looked : String(looked?.score ?? '');
  } else if (ctx.input.trustScore != null) {
    next.trustScore = String(ctx.input.trustScore);
  }
  return next;
}

async function performVerify(run, ctx) {
  const facts = run.checkpoints.decide.facts;
  const priced = typeof ctx.deps.verifyFn === 'function' ? null : await quotedPrice(facts, ctx);
  if (priced?.error) return waitStep(run, 'verify', priced.error, {}, ctx.now);
  const verifyFn = typeof ctx.deps.verifyFn === 'function'
    ? ctx.deps.verifyFn
    : async () => {
      if (priced) {
        const again = await quotedPrice(facts, ctx);
        if (!again || again.error) throw new LoopEngineError(again?.error || 'price_unavailable', 422);
        return { ...facts, price: again.price };
      }
      if (ctx.deps.trustLookup) return verifyFromProviders(facts, ctx);
      const completion = await ctx.models.complete({
        role: 'verify',
        goal: goalFor(run, ctx.bot),
        task: [
          'Role: verify',
          'Independently re-derive trade facts as JSON with asset, mint, cluster, price, amount, trustScore, and reasonSummary.',
          'Do not copy numbers you cannot justify. Do not propose a transaction.',
        ].join('\n'),
        untrusted: [{ role: 'user', content: `Untrusted research summary:\n${clip(run.checkpoints.research?.summary ?? '', 2000)}` }],
      });
      const parsed = extractJson(completion.text);
      const derived = factsFrom(parsed?.facts ?? parsed);
      if (!derived) throw new LoopEngineError('verify-invalid', 422);
      return derived;
    };
  let consensus;
  try {
    const mainFacts = priced ? { ...facts, price: priced.price } : facts;
    consensus = await reachConsensus({ mainFn: async () => mainFacts, verifyFn });
  } catch {
    return waitStep(run, 'verify', 'verify-invalid', {}, ctx.now);
  }
  const attempts = { ...(run.attempts ?? {}), verify: consensus.attempts.length };
  if (consensus.state !== 'consensus') {
    return waitStep({ ...run, attempts }, 'verify', 'verify-mismatch', {
      attemptCount: consensus.attempts.length,
    }, ctx.now);
  }
  const memo = memoFromDecision(consensus.decisionRecord);
  return finishStep({ ...run, attempts }, 'verify', {
    attemptCount: consensus.attempts.length,
    digest: consensus.digest,
    decisionRecord: consensus.decisionRecord,
    memo,
    priceQuote: priced?.quote ?? null,
  }, ctx.now);
}

function performPolicy(run, ctx) {
  const proposal = run.checkpoints.decide.proposal;
  let policy;
  try {
    policy = evaluateProposal(ctx.bot, proposal, ctx.ledger, ctx.now);
  } catch {
    return waitStep(run, 'policy', 'policy-invalid', {}, ctx.now);
  }
  if (policy.state === 'blocked') return waitStep(run, 'policy', policy.reason ?? 'blocked', { policy: slimPolicy(policy) }, ctx.now);
  let needed;
  try {
    needed = approvalRequirement(ctx.bot, policy, approvalOptions(ctx.input));
  } catch {
    return waitStep(run, 'policy', 'policy-invalid', { policy: slimPolicy(policy) }, ctx.now);
  }
  return finishStep(run, 'policy', { policy: slimPolicy(policy), approvalNeeded: needed }, ctx.now);
}

function performApproval(run, ctx) {
  const proposal = run.checkpoints.decide.proposal;
  let policy;
  try {
    policy = evaluateProposal(ctx.bot, proposal, ctx.ledger, ctx.now);
  } catch {
    return waitStep(run, 'approval', 'policy-invalid', {}, ctx.now);
  }
  if (policy.state === 'blocked') return waitStep(run, 'approval', policy.reason ?? 'blocked', { policy: slimPolicy(policy) }, ctx.now);
  const needed = run.checkpoints.policy?.approvalNeeded === true || policy.state === 'over-budget';
  if (!needed) {
    return finishStep(run, 'approval', { action: 'auto', automatic: true, ownerId: ctx.bot.ownerId }, ctx.now);
  }
  const approval = ctx.input.approval;
  if (!approval) return waitStep(run, 'approval', 'approval-needed', { digest: policy.digest }, ctx.now);
  if (approval.action === 'deny') {
    return waitStep(run, 'approval', 'approval-denied', { action: 'deny', ownerId: ctx.ownerId }, ctx.now);
  }
  if (approval.ownerId !== ctx.bot.ownerId || ctx.ownerId !== ctx.bot.ownerId) {
    return waitStep(run, 'approval', 'invalid-approval', {}, ctx.now);
  }
  const record = {
    ownerId: ctx.bot.ownerId,
    botId: ctx.bot.id,
    policyVersion: ctx.bot.policyVersion,
    digest: policy.digest,
    action: approval.action,
    usedAt: null,
    expiresAt: proposal.expiresAt,
  };
  const checked = validateApproval({
    bot: ctx.bot,
    proposal,
    ledger: ctx.ledger,
    approval: record,
    now: ctx.now,
  });
  if (checked.state !== 'ready-to-reserve') {
    return waitStep(run, 'approval', checked.reason ?? 'invalid-approval', { digest: policy.digest }, ctx.now);
  }
  return finishStep(run, 'approval', {
    action: approval.action,
    automatic: false,
    ownerId: ctx.ownerId,
    digest: policy.digest,
  }, ctx.now);
}

function priceErrorCode(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (code === 'client_missing' || code === 'invalid_mint' || code === 'provider_failed' || code === 'provider_unavailable' || code === 'price_not_found' || code === 'provider_rate_limited') {
    return code;
  }
  return 'provider_failed';
}

function publicSwapQuote(swap, outAmount) {
  return {
    inputMint: swap.inputMint,
    outputMint: swap.outputMint,
    inAmount: swap.inAmount,
    outAmount,
    quoteSource: 'jupiter-swap-v1',
    pricingCluster: 'mainnet',
    executionCluster: 'devnet',
    label: 'devnet execution, mainnet pricing',
    broadcast: false,
    authorizesTransaction: false,
  };
}

/**
 * Jupiter quote, then a paper lot marked with the mainnet price.
 * The quote is not a transaction. Signing stays on the devnet transfer below.
 */
async function tradeQuoteAndPaper(swap, ctx, idempotencyKey) {
  const fetcher = typeof ctx.deps.fetch === 'function' ? ctx.deps.fetch : null;
  const quoteFn = typeof ctx.deps.swapQuote === 'function'
    ? ctx.deps.swapQuote
    : (fetcher
      ? intent => readJupiterSwapQuote({
        inputMint: intent.inputMint,
        outputMint: intent.outputMint,
        amount: intent.inAmount,
        fetcher,
        apiKey: ctx.deps.jupiterApiKey ?? null,
      })
      : null);
  if (!quoteFn) return { error: 'client_missing' };
  let quoted;
  try {
    quoted = await quoteFn(swap);
  } catch (error) {
    return { error: priceErrorCode(error) };
  }
  if (
    !quoted
    || quoted.authorizesTransaction === true
    || quoted.broadcast === true
    || quoted.executionCluster !== 'devnet'
    || quoted.swapTransaction != null
    || quoted.serializedTransaction != null
  ) {
    return { error: 'mainnet_trade_refused' };
  }
  const outAmount = typeof quoted.outAmount === 'string' ? quoted.outAmount : '';
  if (!/^(?:[1-9][0-9]{0,39})$/.test(outAmount)) return { error: 'invalid_quote' };
  if (typeof ctx.deps.lookupPrice !== 'function') return { error: 'client_missing' };
  let priceQuote;
  try {
    priceQuote = await ctx.deps.lookupPrice(swap.outputMint);
  } catch (error) {
    return { error: priceErrorCode(error) };
  }
  if (!priceQuote || priceQuote.label !== 'devnet execution, mainnet pricing' || priceQuote.mint !== swap.outputMint) {
    return { error: 'invalid_quote' };
  }
  const fetchedAt = Date.parse(priceQuote.fetchedAt);
  const markedAt = Number.isFinite(fetchedAt) ? fetchedAt : ctx.now;
  let opened;
  try {
    opened = openPaperPosition({
      book: createPaperBook(),
      bot: ctx.bot,
      mint: swap.outputMint,
      quantity: outAmount,
      quote: priceQuote,
      now: markedAt,
      idempotencyKey,
      cluster: 'devnet',
    });
  } catch (error) {
    const code = typeof error?.code === 'string' ? error.code : 'paper_failed';
    return { error: code === 'live_trade_refused' || code === 'mainnet_trade_refused' ? 'mainnet_trade_refused' : code };
  }
  if (opened.fill?.broadcast !== false || opened.position?.mode !== 'paper' || opened.position?.label !== 'devnet execution, mainnet pricing') {
    return { error: 'mainnet_trade_refused' };
  }
  return {
    swapQuote: publicSwapQuote(swap, outAmount),
    paper: {
      positionId: opened.position.id,
      mint: opened.position.mint,
      symbol: opened.position.symbol,
      decimals: opened.position.decimals,
      quantity: opened.position.quantity,
      entryPriceUsd: opened.position.entryPriceUsd,
      label: opened.position.label,
      mode: 'paper',
      broadcast: false,
      cluster: opened.position.cluster,
    },
  };
}

async function performExecute(run, ctx) {
  const memo = run.checkpoints.verify?.memo;
  const proposal = run.checkpoints.decide?.proposal;
  if (typeof memo !== 'string' || !memo || !proposal) return waitStep(run, 'execute', 'memo-missing', {}, ctx.now);
  const idempotencyKey = run.runId;
  let swapQuote = null;
  let paper = null;
  if (ctx.bot?.type === 'trading' && proposal.swap) {
    const traded = await tradeQuoteAndPaper(proposal.swap, ctx, idempotencyKey);
    if (traded.error) return waitStep(run, 'execute', traded.error, { idempotencyKey }, ctx.now);
    swapQuote = traded.swapQuote;
    paper = traded.paper;
  }
  if (!ctx.deps.transferClient && typeof ctx.deps.execute !== 'function') {
    return waitStep(run, 'execute', 'signer-not-configured', { idempotencyKey }, ctx.now);
  }
  const started = withCheckpoint(run, 'execute', {
    at: ctx.now,
    status: 'started',
    idempotencyKey,
    memo,
  });
  await ctx.persist(started);

  let reservation = null;
  if (ctx.deps.ledgerApi && typeof ctx.deps.ledgerApi.reserveBudget === 'function') {
    try {
      reservation = await ctx.deps.ledgerApi.reserveBudget({
        ownerId: ctx.ownerId,
        now: ctx.now,
        idempotencyKey,
        proposal,
        approvalId: run.checkpoints.approval?.approvalId,
      });
      if (reservation?.state && reservation.state !== 'ready-to-reserve' && reservation.state !== 'reserved') {
        return waitStep(started, 'execute', reservation.reason || reservation.state || 'reserve-blocked', {
          idempotencyKey,
          reservation,
        }, ctx.now);
      }
    } catch (error) {
      return waitStep(started, 'execute', error?.code || 'reserve-failed', {
        idempotencyKey,
        message: typeof error?.message === 'string' ? error.message.slice(0, 200) : undefined,
      }, ctx.now);
    }
  }

  const result = ctx.deps.transferClient
    ? await transferDevnetUsdc({
      client: ctx.deps.transferClient,
      bot: ctx.bot,
      wallet: ctx.wallet,
      destination: proposal.recipient,
      amount: proposal.outflow,
      memo,
      recentBlockhash: ctx.deps.recentBlockhash,
    })
    : await ctx.deps.execute({
      bot: ctx.bot,
      wallet: ctx.wallet,
      proposal,
      memo,
      idempotencyKey,
    });
  const cluster = result?.cluster;
  if (cluster !== 'devnet' && cluster !== 'testnet') {
    return waitStep(started, 'execute', 'wrong-cluster', { idempotencyKey }, ctx.now);
  }
  if (result.memo != null && result.memo !== memo) {
    return waitStep(started, 'execute', 'memo-mismatch', { idempotencyKey }, ctx.now);
  }
  if (typeof result.signature !== 'string' || result.signature.length < 1) {
    return waitStep(started, 'execute', 'execute-unconfirmed', { idempotencyKey }, ctx.now);
  }
  return finishStep(started, 'execute', {
    mode: result.kind ?? result.mode ?? 'executed',
    signature: result.signature,
    memo,
    idempotencyKey,
    cluster,
    executed: true,
    reserved: reservation?.state === 'reserved' || reservation?.ok === true,
    ...(swapQuote ? { swapQuote } : {}),
    ...(paper ? { paper } : {}),
  }, ctx.now);
}

function performMemo(run, ctx) {
  const memo = run.checkpoints.verify?.memo;
  const attached = run.checkpoints.execute?.memo;
  const digest = run.checkpoints.verify?.decisionRecord?.recordDigest;
  if (typeof memo !== 'string' || memo !== attached || typeof digest !== 'string') {
    return waitStep(run, 'memo', 'memo-mismatch', {}, ctx.now);
  }
  return finishStep(run, 'memo', { memo, digest, attached: true }, ctx.now);
}

async function performMonitor(run, ctx) {
  const completion = await ctx.models.complete({
    role: 'monitor',
    goal: goalFor(run, ctx.bot),
    task: 'Role: monitor\nThe devnet execution finished. Write a one-line watch note. Do not propose a new spend.',
  });
  if (!(await acceptTurn(ctx, 'monitor', completion.text))) {
    return waitStep(run, 'monitor', 'verifier-blocked', { model: completion.model }, ctx.now);
  }
  return finishStep(run, 'monitor', { note: clip(completion.text, 500), model: completion.model }, ctx.now);
}

async function perform(run, ctx) {
  switch (run.step) {
    case 'research': return performResearch(run, ctx);
    case 'decide': return performDecide(run, ctx);
    case 'trust-gate': return performTrust(run, ctx);
    case 'verify': return performVerify(run, ctx);
    case 'policy': return performPolicy(run, ctx);
    case 'approval': return performApproval(run, ctx);
    case 'execute': return performExecute(run, ctx);
    case 'memo': return performMemo(run, ctx);
    case 'monitor': return performMonitor(run, ctx);
    default: throw new LoopEngineError('unknown_step', 409);
  }
}

/**
 * Run until the loop waits for a person or finishes monitor.
 * `persist` must store the run before the next step, including the pre-execute marker.
 */
export async function runBotLoop({
  run,
  bot,
  wallet,
  ledger,
  ownerId,
  input = {},
  models,
  deps = {},
  now,
  persist,
}) {
  if (!run) throw new LoopEngineError('no_run', 404);
  if (!bot || !wallet || !ledger) throw new LoopEngineError('loop_payload_incomplete', 400);
  if (ownerId !== bot.ownerId || wallet.ownerId !== bot.ownerId) throw new LoopEngineError('owner_mismatch', 403);
  if (ledger.botId !== bot.id || ledger.asset !== bot.cap?.asset) throw new LoopEngineError('invalid_ledger', 400);
  if (!Number.isSafeInteger(now) || now < 1) throw new LoopEngineError('invalid_now', 400);
  if (typeof persist !== 'function') throw new LoopEngineError('persist_required', 500);
  if (!models || typeof models.complete !== 'function') throw new LoopEngineError('openrouter_not_configured', 503);

  const ctx = { bot, wallet, ledger, ownerId, input, models, deps, now, persist };
  let current = { ...run, checkpoints: { ...(run.checkpoints ?? {}) } };

  if (current.paused) {
    const resumed = resolvePause(current, ctx);
    if (resumed.paused) return { run: resumed, waiting: true, done: false };
    current = resumed;
    await persist(current);
  }

  for (let guard = 0; guard < 24; guard += 1) {
    if (current.step === 'idle') {
      current = advanceRun(current, 'research', 'loop', now);
      await persist(current);
      continue;
    }
    const checkpoint = current.checkpoints?.[current.step];
    if (checkpoint?.status === 'done') {
      if (current.step === 'monitor') return { run: current, waiting: false, done: true };
      const nxt = nextLoopStep(current.step);
      if (!nxt) return { run: current, waiting: false, done: false };
      current = advanceRun(current, nxt, nxt, now);
      await persist(current);
      continue;
    }
    if (SPEND_STEPS.has(current.step)) {
      const block = spendBlock(bot, wallet);
      if (block) {
        current = waitStep(current, current.step, 'spend-frozen', { detail: block }, now);
        await persist(current);
        return { run: current, waiting: true, done: false };
      }
    }
    current = await perform(current, ctx);
    await persist(current);
    if (current.paused) return { run: current, waiting: true, done: false };
    if (current.step === 'monitor' && current.checkpoints?.monitor?.status === 'done') {
      return { run: current, waiting: false, done: true };
    }
  }
  throw new LoopEngineError('loop_step_limit', 409);
}
