/**
 * Append-only run checkpoint helpers for a per-bot Durable Object.
 * Queues must not be treated as durable truth — only DO / DB storage.
 */

export const RUN_STEPS = Object.freeze([
  'idle',
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

export function createEmptyRun({ runId, botId, goal, now }) {
  if (typeof runId !== 'string' || !runId || typeof botId !== 'string' || !botId) {
    throw new Error('runId and botId are required');
  }
  return {
    runId,
    botId,
    goal: typeof goal === 'string' ? goal : '',
    step: 'idle',
    paused: false,
    attempts: { verify: 0 },
    lastEventAt: now,
    events: [],
  };
}

export function advanceRun(run, step, summary, now) {
  if (!RUN_STEPS.includes(step)) throw new Error(`Unknown run step: ${step}`);
  if (!run || run.paused) throw new Error('Cannot advance a missing or paused run');
  const event = {
    at: now,
    from: run.step,
    to: step,
    summary: String(summary ?? step).slice(0, 500),
  };
  return {
    ...run,
    step,
    lastEventAt: now,
    events: [...run.events, event].slice(-200),
  };
}

export function pauseRun(run, reason, now) {
  return {
    ...run,
    paused: true,
    pauseReason: String(reason ?? 'paused').slice(0, 200),
    lastEventAt: now,
    events: [...run.events, { at: now, from: run.step, to: run.step, summary: `paused:${reason}` }].slice(-200),
  };
}

export function resumeRun(run, now) {
  if (!run?.paused) return run;
  const { pauseReason: _ignored, ...rest } = run;
  return {
    ...rest,
    paused: false,
    lastEventAt: now,
    events: [...run.events, { at: now, from: run.step, to: run.step, summary: 'resumed' }].slice(-200),
  };
}
