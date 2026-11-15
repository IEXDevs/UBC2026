/**
 * Bot page model: approval preview, live timeline, and the public "why" record.
 * Presentation only. Does not sign, reserve budget, or read secrets.
 */
import { EVENT_KINDS, validateDecisionRecord, validateTimelineEvent } from '@ubc2026/contracts';

export const BOT_PAGE_SECTIONS = Object.freeze([
  'approval-preview',
  'timeline',
  'live-view',
  'why',
]);

const INT = /^(0|[1-9][0-9]{0,39})$/;
const HEX64 = /^[a-f0-9]{64}$/;
const SECRETISH = /https?:\/\/\S+|eyJ[A-Za-z0-9_-]{10,}|jwt=[^\s]+|viewerUrl|chain-of-thought|chainOfThought/gi;

const ACTION_LABELS = Object.freeze({
  approve: 'Approve',
  'approve-once': 'Approve once',
  'raise-limit': 'Raise limit',
});

export function actionLabel(action) {
  return ACTION_LABELS[action] ?? action;
}

export function formatBaseUnits(amount, asset) {
  if (typeof amount !== 'string' || !INT.test(amount) || typeof asset !== 'string' || asset === '') return null;
  const decimals = asset === 'USDC' ? 6 : 0;
  if (decimals === 0) return `${amount} ${asset}`;
  const whole = BigInt(amount);
  const scale = 10n ** BigInt(decimals);
  const major = whole / scale;
  const minor = (whole % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return minor ? `${major}.${minor} ${asset}` : `${major} ${asset}`;
}

export function shortDigest(digest) {
  if (typeof digest !== 'string' || !HEX64.test(digest)) return null;
  return `${digest.slice(0, 8)}…${digest.slice(-6)}`;
}

function redact(summary) {
  return summary.replace(SECRETISH, '[hidden]').replace(/\s+/g, ' ').trim();
}

export function logsUrl(runtimeBase) {
  if (typeof runtimeBase !== 'string' || runtimeBase === '') return null;
  let base;
  try { base = new URL(runtimeBase); } catch { return null; }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') return null;
  const root = `${base.origin}${base.pathname.replace(/\/$/, '')}`;
  return `${root}/api/logs`;
}

export function eventsUrl(runtimeBase, botId) {
  if (typeof runtimeBase !== 'string' || runtimeBase === '' || typeof botId !== 'string' || botId === '') return null;
  let base;
  try { base = new URL(runtimeBase); } catch { return null; }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') return null;
  const root = `${base.origin}${base.pathname.replace(/\/$/, '')}`;
  const url = new URL(`${root}/api/events`);
  url.searchParams.set('botId', botId);
  return url.href;
}

/**
 * Keep concise tool events for one bot. Drop unknown kinds, other bots, and
 * anything that would leak a Live View URL or hidden chain-of-thought.
 */
/** Supabase timestamps arrive as ISO strings. The event validator wants epoch ms. */
export function normalizeLiveEvent(row) {
  if (!row || typeof row !== 'object') return null;
  if (typeof row.at !== 'string') return row;
  const ms = Date.parse(row.at);
  if (!Number.isSafeInteger(ms) || ms <= 0) return row;
  return { ...row, at: ms };
}

export function timelineEntries(events, botId) {
  if (!Array.isArray(events)) return [];
  const kept = [];
  for (const event of events) {
    if (!event || event.botId !== botId || !EVENT_KINDS.includes(event.kind)) continue;
    if (typeof event.summary !== 'string') continue;
    const summary = redact(event.summary);
    if (!summary || summary.length > 500) continue;
    try {
      validateTimelineEvent({ ...event, summary });
    } catch {
      continue;
    }
    kept.push({
      id: event.id,
      botId: event.botId,
      at: event.at,
      kind: event.kind,
      summary,
    });
  }
  kept.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  return kept;
}

function previewActions(state) {
  if (state === 'over-budget') return ['approve-once', 'raise-limit'];
  if (state === 'approval-needed') return ['approve'];
  return [];
}

export function buildApprovalPreview(preview) {
  if (!preview) {
    return {
      state: 'clear',
      actions: [],
      title: 'Approval preview',
      body: 'No spend is waiting. The next action shows here before anything is signed.',
    };
  }
  const state = preview.state;
  const digest = typeof preview.digest === 'string' && HEX64.test(preview.digest) ? preview.digest : null;
  const outflowLabel = formatBaseUnits(preview.outflow, preview.asset);
  const feeLabel = formatBaseUnits(preview.maxFee, preview.asset);
  const receiveLabel = formatBaseUnits(preview.expectedReceive, preview.expectedReceiveAsset);
  const usable = digest && outflowLabel && feeLabel && receiveLabel
    && typeof preview.recipient === 'string' && preview.recipient.length > 0
    && (state === 'approval-needed' || state === 'over-budget' || state === 'blocked');
  if (!usable) {
    return {
      state: 'blocked',
      actions: [],
      title: 'Approval preview',
      body: 'This preview is incomplete, so nothing can be approved.',
    };
  }
  return {
    id: preview.id,
    botId: preview.botId,
    state,
    actions: previewActions(state),
    title: 'Approval preview',
    cluster: preview.cluster,
    asset: preview.asset,
    recipient: preview.recipient,
    outflowLabel,
    feeLabel,
    receiveLabel,
    digest,
    digestShort: shortDigest(digest),
    violations: Array.isArray(preview.violations) ? preview.violations.filter(item => typeof item === 'string') : [],
    expiresAt: preview.expiresAt,
    currentCap: preview.currentCap ?? null,
    body: state === 'blocked'
      ? (preview.reason === 'max-loss-reached'
        ? 'Max loss is already reached. This preview cannot be approved.'
        : 'This preview is blocked. Nothing will be signed.')
      : 'Review the spend before approving. This screen does not sign or broadcast.',
  };
}

export function raisedCap(type, current, next) {
  const keys = type === 'position-management' ? ['maxLoss'] : ['maxOutflow', 'maxPerTransaction'];
  if (!current || !next) return { ok: false, reason: 'invalid-cap' };
  const cap = {};
  for (const key of keys) {
    if (typeof current[key] !== 'string' || !INT.test(current[key])) return { ok: false, reason: 'invalid-cap' };
    if (typeof next[key] !== 'string' || !INT.test(next[key])) return { ok: false, reason: 'invalid-cap' };
    if (BigInt(next[key]) < BigInt(current[key])) return { ok: false, reason: 'cannot-lower-limit' };
    cap[key] = next[key];
  }
  return { ok: true, cap };
}

function memoMatches(decision) {
  if (typeof decision.memo !== 'string' || decision.memo.length > 512) return null;
  try {
    const parsed = JSON.parse(decision.memo);
    if (parsed?.v !== 1 || parsed?.o !== 'c') return null;
    if (parsed.d !== decision.factsDigest || parsed.r !== decision.decisionDigest) return null;
    return decision.memo;
  } catch {
    return null;
  }
}

/**
 * Public explanation from the decision record and tool timeline.
 * Hidden reasoning fields are dropped.
 */
export function whyExplanation(decision, events = []) {
  const empty = {
    title: 'Why did it do this?',
    showsChainOfThought: false,
    lines: ['No decision record is stored for this bot yet.'],
    digests: null,
    memo: null,
    reasonSummary: null,
    focus: null,
  };
  if (!decision) return empty;
  try { validateDecisionRecord(decision); } catch { return empty; }
  if (typeof decision.decisionDigest !== 'string' || !HEX64.test(decision.decisionDigest)) return empty;
  const reasonSummary = typeof decision.reasonSummary === 'string'
    ? redact(decision.reasonSummary).slice(0, 500)
    : '';
  const mismatches = Array.isArray(decision.mismatches) ? decision.mismatches.length : 0;
  const lines = [
    reasonSummary || 'The verifier stored a decision record without a public reason summary.',
    `Facts digest ${shortDigest(decision.factsDigest)}. Proposal digest ${shortDigest(decision.proposalDigest)}. Decision record ${shortDigest(decision.decisionDigest)}.`,
    decision.status === 'mismatch'
      ? `Verification did not settle (${mismatches} mismatch${mismatches === 1 ? '' : 'es'}). The spend stays unsigned.`
      : `Status is ${decision.status} on ${decision.cluster}. The record is the explanation, not a hidden chain of thought.`,
  ];
  const memo = memoMatches(decision);
  if (memo) lines.push('The memo binds the facts digest and the decision record.');
  else if (decision.memo != null) lines.push('A memo was present but does not match this decision record, so it is hidden.');
  return {
    title: 'Why did it do this?',
    showsChainOfThought: false,
    lines,
    digests: {
      facts: decision.factsDigest,
      proposal: decision.proposalDigest,
      decision: decision.decisionDigest,
    },
    memo,
    reasonSummary: reasonSummary || null,
    status: decision.status,
    cluster: decision.cluster,
    focus: null,
    related: timelineEntries(events, decision.botId).filter(event => (
      event.kind === 'tool.call'
      || event.kind === 'trust.gate'
      || event.kind === 'verify.attempt'
      || event.kind === 'verify.settled'
      || event.kind === 'verify.mismatch'
      || event.kind === 'approval.requested'
    )),
  };
}

export function buildBotPage({ botId, preview, events, decision }) {
  const timeline = timelineEntries(events, botId);
  const why = whyExplanation(decision, events);
  return {
    botId,
    sections: [
      { id: 'approval-preview', preview: buildApprovalPreview(preview) },
      { id: 'timeline', entries: timeline },
      { id: 'live-view' },
      { id: 'why', why },
    ],
  };
}

const DIGEST = {
  meteoraFacts: 'a11ce0000000000000000000000000000000000000000000000000000000aa00',
  meteoraProposal: 'b22ce0000000000000000000000000000000000000000000000000000000bb00',
  meteoraDecision: 'c33ce0000000000000000000000000000000000000000000000000000000cc00',
  shopFacts: 'd44ce0000000000000000000000000000000000000000000000000000000dd00',
  shopProposal: 'e55ce0000000000000000000000000000000000000000000000000000000ee00',
  shopDecision: 'f66ce0000000000000000000000000000000000000000000000000000000ff00',
  guardFacts: '011ce0000000000000000000000000000000000000000000000000000000a100',
  guardProposal: '022ce0000000000000000000000000000000000000000000000000000000b200',
  guardDecision: '033ce000000000000000000000000000000000000000000000000000000000c3',
};

function event(id, botId, ownerId, kind, summary, at) {
  return validateTimelineEvent({ id, botId, ownerId, kind, summary, at, prevHash: null });
}

function decision(fields) {
  const memo = JSON.stringify({ v: 1, o: 'c', d: fields.factsDigest, r: fields.decisionDigest });
  return {
    ...validateDecisionRecord(fields),
    decisionDigest: fields.decisionDigest,
    reasonSummary: fields.reasonSummary,
    mismatches: fields.mismatches ?? [],
    memo: fields.status === 'mismatch' ? null : memo,
  };
}

/** Local bot-page fixtures. Remote /api/events replaces the timeline when it is live. */
export function demoBotExperiences(ownerId = 'demo_owner') {
  const owner = ownerId || 'demo_owner';
  return {
    bot_meteora: {
      preview: {
        id: 'preview_meteora',
        botId: 'bot_meteora',
        state: 'approval-needed',
        cluster: 'devnet',
        asset: 'USDC',
        recipient: 'alex.sol',
        outflow: '5000000',
        maxFee: '10000',
        expectedReceive: '25000000',
        expectedReceiveAsset: 'SOL',
        digest: DIGEST.meteoraProposal,
        violations: [],
        expiresAt: 1763200000000,
      },
      events: [
        event('evt_meteora_research', 'bot_meteora', owner, 'tool.call', 'Firecrawl research: Meteora pool APY snapshot', 1763100000000),
        event('evt_meteora_trust', 'bot_meteora', owner, 'trust.gate', 'Trust gate cleared for the SOL/USDC check', 1763100120000),
        event('evt_meteora_verify', 'bot_meteora', owner, 'verify.settled', 'Verify-agent matched price and mint on attempt 1', 1763100180000),
        event('evt_meteora_approval', 'bot_meteora', owner, 'approval.requested', 'Approval requested before sending 5 USDC to alex.sol', 1763100240000),
      ],
      decision: decision({
        id: 'dec_meteora',
        botId: 'bot_meteora',
        runId: 'run_meteora',
        cluster: 'devnet',
        factsDigest: DIGEST.meteoraFacts,
        proposalDigest: DIGEST.meteoraProposal,
        decisionDigest: DIGEST.meteoraDecision,
        createdAt: 1763100180000,
        status: 'pending',
        reasonSummary: 'Hourly check found a stable pool. The verifier agreed on mint, price, trust score, and the 5 USDC size.',
      }),
    },
    bot_shop: {
      preview: {
        id: 'preview_shop',
        botId: 'bot_shop',
        state: 'over-budget',
        cluster: 'devnet',
        asset: 'USDC',
        recipient: 'sandbox-store',
        outflow: '12000000',
        maxFee: '5000',
        expectedReceive: '1',
        expectedReceiveAsset: 'ITEM',
        digest: DIGEST.shopProposal,
        violations: ['per-transaction'],
        expiresAt: 1763200000000,
        currentCap: { mode: 'limited', asset: 'USDC', maxOutflow: '50000000', maxPerTransaction: '5000000' },
      },
      events: [
        event('evt_shop_search', 'bot_shop', owner, 'tool.call', 'Compared the x402 sandbox catalog', 1763090000000),
        event('evt_shop_approval', 'bot_shop', owner, 'approval.requested', 'Quote is above the per-transaction cap', 1763090300000),
      ],
      decision: decision({
        id: 'dec_shop',
        botId: 'bot_shop',
        runId: 'run_shop',
        cluster: 'devnet',
        factsDigest: DIGEST.shopFacts,
        proposalDigest: DIGEST.shopProposal,
        decisionDigest: DIGEST.shopDecision,
        createdAt: 1763090300000,
        status: 'pending',
        reasonSummary: 'The sandbox item matched the goal, and the quote is above the per-transaction cap.',
      }),
    },
    bot_positions: {
      preview: null,
      events: [
        event('evt_guard_check', 'bot_positions', owner, 'tool.call', 'Hourly paper PnL check on mainnet prices', 1763080000000),
        event('evt_guard_mismatch', 'bot_positions', owner, 'verify.mismatch', 'Verifier still disagrees on price after five attempts', 1763080300000),
      ],
      decision: decision({
        id: 'dec_guard',
        botId: 'bot_positions',
        runId: 'run_guard',
        cluster: 'devnet',
        factsDigest: DIGEST.guardFacts,
        proposalDigest: DIGEST.guardProposal,
        decisionDigest: DIGEST.guardDecision,
        createdAt: 1763080300000,
        status: 'mismatch',
        reasonSummary: 'Price from the main pass and the verify pass still differ, so the position change stopped for review.',
        mismatches: [{ attempt: 5, field: 'price' }],
      }),
    },
  };
}
