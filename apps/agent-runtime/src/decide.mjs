import { runDecisionGate } from '@ubc2026/agent-loop';
import { advanceRun, pauseRun } from './checkpoint.mjs';

/**
 * Run the safety gate against an in-flight checkpoint.
 * Callers supply bot/wallet/ledger/proposal plus independent fact producers.
 * No signing happens here — approval-needed pauses the run for the owner.
 */
export async function decideFromCheckpoint({
  run,
  bot,
  wallet,
  ledger,
  proposal,
  trustScore,
  trustConfirmed = false,
  mainFn,
  verifyFn,
  now = Date.now(),
}) {
  if (!run) throw new Error('no_run');
  if (run.paused) throw new Error('run_paused');

  let next = advanceRun(run, 'trust-gate', 'evaluate trust', now);
  next = advanceRun(next, 'verify', 'independent verify', now);
  next = advanceRun(next, 'policy', 'bot policy', now);

  const gate = await runDecisionGate({
    bot,
    wallet,
    ledger,
    proposal,
    trustScore,
    trustConfirmed,
    mainFn,
    verifyFn,
    now,
  });

  if (gate.state === 'trust-confirmation-required') {
    next = pauseRun(next, 'trust-confirmation', now);
    return { run: next, gate };
  }
  if (gate.state === 'verify-mismatch') {
    next = pauseRun(next, 'verify-mismatch', now);
    return { run: next, gate };
  }
  if (gate.state === 'blocked') {
    next = pauseRun(next, gate.reason ?? 'blocked', now);
    return { run: next, gate };
  }
  if (gate.state === 'approval-needed') {
    next = advanceRun(next, 'approval', 'awaiting owner approval', now);
    next = pauseRun(next, 'approval-needed', now);
    return { run: next, gate };
  }

  next = advanceRun(next, 'execute', 'ready to execute under policy', now);
  return { run: next, gate };
}
