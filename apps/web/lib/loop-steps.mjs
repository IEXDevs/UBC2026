/**
 * Ordered autonomous-loop steps for the view beside the browser.
 * Reads a checkpointed run already stored by the bot Durable Object.
 * Does not start a run, sign, or broadcast. Live View URLs stay out of the list.
 */

export const LOOP_STEPS = Object.freeze([
  Object.freeze({ id: 'research', label: 'Research' }),
  Object.freeze({ id: 'decide', label: 'Decide' }),
  Object.freeze({ id: 'trust-gate', label: 'Trust gate' }),
  Object.freeze({ id: 'verify', label: 'Verify' }),
  Object.freeze({ id: 'policy', label: 'Policy' }),
  Object.freeze({ id: 'approval', label: 'Request approval' }),
  Object.freeze({ id: 'execute', label: 'Execute' }),
  Object.freeze({ id: 'memo', label: 'Memo' }),
  Object.freeze({ id: 'monitor', label: 'Monitor' }),
]);

const SECRETISH = /https?:\/\/\S+|eyJ[A-Za-z0-9_-]{8,}|jwt=[^\s]+|viewerUrl|live\.browser\.run|chain-of-thought|chainOfThought/gi;

export function redactLoopDetail(value) {
  if (typeof value !== 'string') return '';
  const clean = value.replace(SECRETISH, '[hidden]').replace(/\s+/g, ' ').trim();
  if (!clean || clean === '[hidden]') return '';
  return clean.slice(0, 140);
}

export function loopStepStateLabel(step) {
  if (!step || step.state === 'pending') return 'Pending';
  if (step.state === 'thinking') return 'Thinking';
  if (step.state === 'verifying') return 'Verifying';
  if (step.state === 'waiting') return step.id === 'approval' ? 'Waiting for approval' : 'Waiting';
  if (step.state === 'executed') return 'Executed';
  if (step.state === 'running') return 'Running';
  if (step.state === 'error') return 'Blocked';
  return 'Pending';
}

function checkpointDetail(checkpoint) {
  if (!checkpoint || typeof checkpoint !== 'object') return '';
  const reason = typeof checkpoint.reason === 'string' ? checkpoint.reason : '';
  const summary = typeof checkpoint.summary === 'string' ? checkpoint.summary : '';
  return redactLoopDetail(reason || summary);
}

function eventDetail(run, id) {
  const events = Array.isArray(run?.events) ? run.events : [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event || event.to !== id || typeof event.summary !== 'string') continue;
    const text = redactLoopDetail(event.summary);
    if (!text) continue;
    if (text === 'resumed') continue;
    if (text.startsWith('paused:')) return redactLoopDetail(text.slice('paused:'.length));
    return text;
  }
  return '';
}

function stateFor(id, checkpoint, run) {
  const raw = checkpoint && typeof checkpoint.status === 'string' ? checkpoint.status : '';
  const current = run && typeof run.step === 'string' ? run.step : '';
  const paused = run?.paused === true;
  if (raw === 'done') return 'executed';
  if (raw === 'error' || raw === 'failed' || raw === 'blocked') return 'error';
  if (raw === 'waiting' || (paused && current === id)) return 'waiting';
  if (raw === 'started' || current === id) {
    if (id === 'trust-gate' || id === 'verify' || id === 'policy') return 'verifying';
    if (id === 'approval') return 'waiting';
    if (id === 'research' || id === 'decide') return 'thinking';
    return 'running';
  }
  return 'pending';
}

export function loopStepsFromRun(run) {
  const checkpoints = run && typeof run.checkpoints === 'object' && !Array.isArray(run.checkpoints)
    ? run.checkpoints
    : {};
  return LOOP_STEPS.map((step) => {
    const checkpoint = checkpoints[step.id];
    const state = stateFor(step.id, checkpoint, run);
    const fromCheckpoint = checkpointDetail(checkpoint);
    const detail = fromCheckpoint || (state === 'pending' ? '' : eventDetail(run, step.id));
    return {
      id: step.id,
      label: step.label,
      state,
      detail,
    };
  });
}
