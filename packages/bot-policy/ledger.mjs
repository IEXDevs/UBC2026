/**
 * Supabase spend-ledger wiring for bot-policy.
 *
 * assessSpend is the pure preview. Production reserves and kill-switch
 * updates go through the SQL functions in supabase/migrations (one
 * transaction, row locks, idempotency key). createSupabaseLedger only
 * forwards payloads — it does not open a connection or read secrets.
 *
 * createMemoryLedger is a serialized test double with the same rules.
 * Do not use it as the production ledger.
 */
import { evaluateProposal, proposalDigest, validateApproval, PolicyError } from './policy.mjs';

export { PolicyError };

const fail = message => { throw new PolicyError(message); };
const AMOUNT = /^(0|[1-9][0-9]{0,39})$/;
const KEY = /^[a-zA-Z0-9:_-]{1,128}$/;

function amount(value) {
  if (typeof value !== 'string' || !AMOUNT.test(value)) fail('Amounts must be unsigned integer strings in base units');
  return BigInt(value);
}

function requireNow(now) {
  if (!Number.isSafeInteger(now) || now < 0) fail('Explicit server time is required');
}

function requireOwner(ownerId) {
  if (typeof ownerId !== 'string' || !KEY.test(ownerId)) fail('ownerId is required');
}

function requireKey(key) {
  if (typeof key !== 'string' || !KEY.test(key)) fail('idempotency key is required');
}

function ledgerView(ledger) {
  return { asset: ledger.asset, spent: ledger.spent, reserved: ledger.reserved, realizedLoss: ledger.realizedLoss };
}

/**
 * Preview a proposal against trusted bot, wallet, and ledger rows.
 * Does not reserve budget. ownerId is checked when provided.
 */
export function assessSpend({ bot, wallet, ledger, proposal, approval, now, ownerId }) {
  requireNow(now);
  if (ownerId != null) requireOwner(ownerId);
  if (!bot) return { state: 'blocked', reason: 'bot-missing' };
  if (ownerId != null && ownerId !== bot.ownerId) return { state: 'blocked', reason: 'wrong-owner' };
  if (!wallet) return { state: 'blocked', reason: 'wallet-missing' };
  if (wallet.ownerId !== bot.ownerId) return { state: 'blocked', reason: 'wallet-owner-mismatch' };
  if (wallet.frozen) return { state: 'blocked', reason: 'wallet-frozen' };
  if (bot.frozen) return { state: 'blocked', reason: 'bot-frozen' };
  if (!ledger) return { state: 'blocked', reason: 'ledger-missing' };

  const mode = bot.approvalMode ?? 'ask';
  if (!['ask', 'fully-automatic', 'capped-automatic'].includes(mode)) fail('Unknown approval mode');
  if (mode === 'capped-automatic') amount(String(bot.autoApproveCap ?? ''));

  const decision = evaluateProposal(bot, proposal, ledgerView(ledger), now);
  if (decision.state === 'blocked') return decision;

  const needsApproval = decision.state === 'over-budget'
    || mode === 'ask'
    || (mode === 'capped-automatic' && BigInt(decision.debit) > amount(bot.autoApproveCap));

  if (needsApproval) {
    if (!approval) return decision;
    return validateApproval({ bot, proposal, ledger: ledgerView(ledger), approval, now });
  }
  if (approval) {
    const checked = validateApproval({ bot, proposal, ledger: ledgerView(ledger), approval, now });
    if (checked.state !== 'ready-to-reserve') return checked;
  }
  return { state: 'ready-to-reserve', digest: decision.digest, debit: decision.debit, approvalMode: mode };
}

function emptyState() {
  return { users: {}, wallets: {}, bots: {}, ledgers: {}, approvals: {}, reservations: {}, events: [], seq: 1 };
}

function loadFixture(fixture) {
  const state = emptyState();
  for (const user of fixture?.users ?? []) state.users[user.id] = { ...user };
  for (const wallet of fixture?.wallets ?? []) state.wallets[wallet.id] = { ...wallet, frozen: wallet.frozen === true };
  for (const bot of fixture?.bots ?? []) {
    state.bots[bot.id] = { ...bot, enabled: bot.enabled !== false, frozen: bot.frozen === true, cap: { ...bot.cap } };
  }
  for (const row of fixture?.ledgers ?? []) state.ledgers[row.botId] = { ...row };
  for (const approval of fixture?.approvals ?? []) state.approvals[approval.id] = { ...approval, usedAt: approval.usedAt ?? null };
  return state;
}

function pushEvent(state, event) {
  state.events.push({ id: `evt_${state.seq++}`, prevHash: null, ...event });
}

function takeBot(state, input) {
  requireOwner(input.ownerId);
  requireNow(input.now);
  const bot = state.bots[input.botId];
  if (!bot) return { error: { state: 'blocked', reason: 'bot-missing' } };
  if (bot.ownerId !== input.ownerId) return { error: { state: 'blocked', reason: 'wrong-owner' } };
  return { bot };
}

function decide(state, input) {
  requireOwner(input.ownerId);
  requireNow(input.now);
  if (!input.proposal) fail('Incomplete transaction preview');
  const bot = state.bots[input.proposal.botId];
  if (!bot) return { state: 'blocked', reason: 'bot-missing' };
  if (input.ownerId !== bot.ownerId) return { state: 'blocked', reason: 'wrong-owner' };
  const wallet = state.wallets[bot.walletId];
  const ledger = state.ledgers[bot.id];
  const approval = input.approvalId ? state.approvals[input.approvalId] : null;
  if (input.approvalId && !approval) return { state: 'blocked', reason: 'invalid-approval' };
  return assessSpend({ bot, wallet, ledger, proposal: input.proposal, approval, now: input.now, ownerId: input.ownerId });
}

function reserve(state, input) {
  requireKey(input.idempotencyKey);
  const digest = proposalDigest(input.proposal);
  const existing = state.reservations[input.idempotencyKey];
  if (existing) {
    if (existing.digest !== digest || existing.botId !== input.proposal.botId) fail('idempotency-mismatch');
    return {
      state: 'reserved',
      replay: true,
      debit: existing.debit,
      digest,
      reservation: { ...existing },
      ledger: { ...state.ledgers[existing.botId] },
    };
  }
  const decision = decide(state, input);
  if (decision.state !== 'ready-to-reserve') return { ...decision, replay: false };
  const ledger = state.ledgers[input.proposal.botId];
  ledger.reserved = (BigInt(ledger.reserved) + BigInt(decision.debit)).toString();
  if (input.approvalId) state.approvals[input.approvalId].usedAt = input.now;
  const reservation = {
    idempotencyKey: input.idempotencyKey,
    botId: input.proposal.botId,
    ownerId: input.ownerId,
    digest,
    debit: decision.debit,
    approvalId: input.approvalId ?? null,
    status: 'reserved',
  };
  state.reservations[input.idempotencyKey] = reservation;
  pushEvent(state, {
    botId: input.proposal.botId,
    ownerId: input.ownerId,
    kind: 'budget.reserved',
    summary: `Reserved ${decision.debit} ${input.proposal.asset}`,
    at: input.now,
  });
  return { state: 'reserved', replay: false, debit: decision.debit, digest, reservation: { ...reservation }, ledger: { ...ledger } };
}

function pauseBot(state, input) {
  const found = takeBot(state, input);
  if (found.error) return found.error;
  if (!found.bot.enabled) return { state: 'paused', botId: found.bot.id, enabled: false, frozen: found.bot.frozen, changed: false };
  found.bot.enabled = false;
  pushEvent(state, { botId: found.bot.id, ownerId: found.bot.ownerId, kind: 'bot.paused', summary: 'Paused bot', at: input.now });
  return { state: 'paused', botId: found.bot.id, enabled: false, frozen: found.bot.frozen, changed: true };
}

function resumeBot(state, input) {
  const found = takeBot(state, input);
  if (found.error) return found.error;
  if (found.bot.frozen) return { state: 'blocked', reason: 'bot-frozen' };
  if (found.bot.enabled) return { state: 'resumed', botId: found.bot.id, enabled: true, changed: false };
  found.bot.enabled = true;
  pushEvent(state, { botId: found.bot.id, ownerId: found.bot.ownerId, kind: 'bot.enabled', summary: 'Resumed bot', at: input.now });
  return { state: 'resumed', botId: found.bot.id, enabled: true, changed: true };
}

function stopAll(state, input) {
  requireOwner(input.ownerId);
  requireNow(input.now);
  const bots = Object.values(state.bots).filter(bot => bot.ownerId === input.ownerId).sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const bot of bots) {
    bot.enabled = false;
    pushEvent(state, { botId: bot.id, ownerId: bot.ownerId, kind: 'kill.stop-all', summary: 'Stop All', at: input.now });
  }
  return { state: 'stopped', botIds: bots.map(bot => bot.id) };
}

function freezeBot(state, input) {
  const found = takeBot(state, input);
  if (found.error) return found.error;
  const changed = !found.bot.frozen || found.bot.enabled;
  found.bot.frozen = true;
  found.bot.enabled = false;
  if (changed) pushEvent(state, { botId: found.bot.id, ownerId: found.bot.ownerId, kind: 'bot.frozen', summary: 'Froze bot', at: input.now });
  return { state: 'frozen', botId: found.bot.id, frozen: true, enabled: false, changed };
}

function unfreezeBot(state, input) {
  const found = takeBot(state, input);
  if (found.error) return found.error;
  if (!found.bot.frozen) return { state: 'unfrozen', botId: found.bot.id, frozen: false, enabled: found.bot.enabled, changed: false };
  found.bot.frozen = false;
  pushEvent(state, { botId: found.bot.id, ownerId: found.bot.ownerId, kind: 'bot.unfrozen', summary: 'Unfroze bot', at: input.now });
  return { state: 'unfrozen', botId: found.bot.id, frozen: false, enabled: found.bot.enabled, changed: true };
}

function takeWallet(state, input) {
  requireOwner(input.ownerId);
  requireNow(input.now);
  const wallet = state.wallets[input.walletId];
  if (!wallet) return { error: { state: 'blocked', reason: 'wallet-missing' } };
  if (wallet.ownerId !== input.ownerId) return { error: { state: 'blocked', reason: 'wrong-owner' } };
  const bots = Object.values(state.bots).filter(bot => bot.walletId === wallet.id).sort((a, b) => (a.id < b.id ? -1 : 1));
  return { wallet, bots };
}

function freezeWallet(state, input) {
  const found = takeWallet(state, input);
  if (found.error) return found.error;
  const changed = !found.wallet.frozen;
  found.wallet.frozen = true;
  if (changed) {
    for (const bot of found.bots) {
      pushEvent(state, { botId: bot.id, ownerId: bot.ownerId, kind: 'wallet.frozen', summary: 'Froze wallet', at: input.now });
    }
  }
  return { state: 'frozen', walletId: found.wallet.id, botIds: found.bots.map(bot => bot.id), changed };
}

function unfreezeWallet(state, input) {
  const found = takeWallet(state, input);
  if (found.error) return found.error;
  const changed = found.wallet.frozen;
  found.wallet.frozen = false;
  if (changed) {
    for (const bot of found.bots) {
      pushEvent(state, { botId: bot.id, ownerId: bot.ownerId, kind: 'wallet.unfrozen', summary: 'Unfroze wallet', at: input.now });
    }
  }
  return { state: 'unfrozen', walletId: found.wallet.id, botIds: found.bots.map(bot => bot.id), changed };
}

function project(state) {
  const byId = (a, b) => (a.id < b.id ? -1 : 1);
  return {
    bots: Object.values(state.bots).sort(byId).map(bot => ({
      id: bot.id, ownerId: bot.ownerId, walletId: bot.walletId, enabled: bot.enabled, frozen: bot.frozen,
    })),
    wallets: Object.values(state.wallets).sort(byId).map(wallet => ({
      id: wallet.id, ownerId: wallet.ownerId, frozen: wallet.frozen,
    })),
    ledgers: Object.values(state.ledgers).sort((a, b) => (a.botId < b.botId ? -1 : 1)).map(row => ({
      botId: row.botId, asset: row.asset, spent: row.spent, reserved: row.reserved, realizedLoss: row.realizedLoss,
    })),
    reservations: Object.values(state.reservations).sort((a, b) => (a.idempotencyKey < b.idempotencyKey ? -1 : 1)).map(row => ({ ...row })),
    events: state.events.map(event => ({ botId: event.botId, ownerId: event.ownerId, kind: event.kind, summary: event.summary })),
  };
}

const MUTATIONS = {
  reserveBudget: reserve,
  pauseBot,
  resumeBot,
  stopAll,
  freezeBot,
  unfreezeBot,
  freezeWallet,
  unfreezeWallet,
};

export function createMemoryLedger() {
  const box = { state: emptyState(), queue: Promise.resolve() };
  function transact(fn) {
    const run = box.queue.then(async () => {
      const snapshot = structuredClone(box.state);
      try {
        return structuredClone(fn(box.state));
      } catch (error) {
        box.state = snapshot;
        throw error;
      }
    });
    box.queue = run.then(() => {}, () => {});
    return run;
  }
  return {
    async reset(fixture) { await transact(() => { box.state = loadFixture(fixture); return null; }); },
    async preview(input) { return transact(state => decide(state, input)); },
    async snapshot() { return transact(state => project(state)); },
    reserveBudget: input => transact(state => MUTATIONS.reserveBudget(state, input)),
    pauseBot: input => transact(state => MUTATIONS.pauseBot(state, input)),
    resumeBot: input => transact(state => MUTATIONS.resumeBot(state, input)),
    stopAll: input => transact(state => MUTATIONS.stopAll(state, input)),
    freezeBot: input => transact(state => MUTATIONS.freezeBot(state, input)),
    unfreezeBot: input => transact(state => MUTATIONS.unfreezeBot(state, input)),
    freezeWallet: input => transact(state => MUTATIONS.freezeWallet(state, input)),
    unfreezeWallet: input => transact(state => MUTATIONS.unfreezeWallet(state, input)),
  };
}

const RPC = Object.freeze({
  preview: 'policy_assess_spend',
  reserveBudget: 'policy_reserve_budget',
  pauseBot: 'policy_pause_bot',
  resumeBot: 'policy_resume_bot',
  stopAll: 'policy_stop_all',
  freezeBot: 'policy_freeze_bot',
  unfreezeBot: 'policy_unfreeze_bot',
  freezeWallet: 'policy_freeze_wallet',
  unfreezeWallet: 'policy_unfreeze_wallet',
});

/**
 * @param {(functionName: string, payload: object) => Promise<object>} call
 * Resolves to the jsonb result of the matching Postgres function.
 */
export function createSupabaseLedger(call) {
  if (typeof call !== 'function') fail('Supabase RPC caller is required');
  const api = {};
  for (const [method, name] of Object.entries(RPC)) {
    api[method] = payload => call(name, payload);
  }
  return api;
}
