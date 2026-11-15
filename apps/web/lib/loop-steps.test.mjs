import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LOOP_STEPS,
  loopStepStateLabel,
  loopStepsFromRun,
  redactLoopDetail,
} from './loop-steps.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('an empty run lists every loop step as pending beside the browser', () => {
  const steps = loopStepsFromRun(null);
  assert.deepEqual(steps.map(step => step.id), LOOP_STEPS.map(step => step.id));
  assert.deepEqual(steps.map(step => step.state), steps.map(() => 'pending'));
  assert.equal(loopStepStateLabel(steps[0]), 'Pending');
  assert.equal(steps.some(step => step.detail.includes('http')), false);
});

test('checkpointed steps keep order and visual states', () => {
  const steps = loopStepsFromRun({
    step: 'verify',
    paused: false,
    checkpoints: {
      research: { status: 'done', summary: 'Pool snapshot' },
      decide: { status: 'done' },
      'trust-gate': { status: 'done' },
      verify: { status: 'started' },
    },
    events: [
      { to: 'research', summary: 'started research' },
      { to: 'verify', summary: 'consensus round' },
    ],
  });
  const byId = Object.fromEntries(steps.map(step => [step.id, step]));
  assert.equal(byId.research.state, 'executed');
  assert.equal(loopStepStateLabel(byId.research), 'Executed');
  assert.equal(byId.research.detail, 'Pool snapshot');
  assert.equal(byId.decide.state, 'executed');
  assert.equal(byId['trust-gate'].state, 'executed');
  assert.equal(byId.verify.state, 'verifying');
  assert.equal(loopStepStateLabel(byId.verify), 'Verifying');
  assert.equal(byId.verify.detail, 'consensus round');
  assert.equal(byId.policy.state, 'pending');
  assert.equal(byId.approval.state, 'pending');
  assert.equal(byId.monitor.state, 'pending');
});

test('approval wait and a paused current step read as waiting', () => {
  const waiting = loopStepsFromRun({
    step: 'approval',
    paused: true,
    checkpoints: {
      research: { status: 'done' },
      approval: { status: 'waiting', reason: 'approval-needed' },
    },
  });
  const approval = waiting.find(step => step.id === 'approval');
  assert.equal(approval.state, 'waiting');
  assert.equal(loopStepStateLabel(approval), 'Waiting for approval');
  assert.equal(approval.detail, 'approval-needed');

  const pausedResearch = loopStepsFromRun({ step: 'research', paused: true, checkpoints: {} });
  const research = pausedResearch.find(step => step.id === 'research');
  assert.equal(research.state, 'waiting');
  assert.equal(loopStepStateLabel(research), 'Waiting');
});

test('the current research or decide step reads as thinking', () => {
  const steps = loopStepsFromRun({ step: 'decide', paused: false, checkpoints: { research: { status: 'done' } } });
  const decide = steps.find(step => step.id === 'decide');
  assert.equal(decide.state, 'thinking');
  assert.equal(loopStepStateLabel(decide), 'Thinking');
});

test('loop details drop live view URLs and hidden reasoning', () => {
  const leaked = 'Open https://live.browser.run/ui/view?jwt=eyJhbGciOiJub25lIn0.secret viewerUrl';
  assert.equal(redactLoopDetail(leaked).includes('live.browser.run'), false);
  assert.equal(redactLoopDetail(leaked).includes('eyJ'), false);
  assert.equal(redactLoopDetail(leaked).includes('http'), false);
  const steps = loopStepsFromRun({
    step: 'research',
    checkpoints: { research: { status: 'started', summary: leaked } },
  });
  const research = steps.find(step => step.id === 'research');
  assert.equal(research.detail.includes('http'), false);
  assert.equal(research.detail.includes('live.browser.run'), false);
  assert.equal(JSON.stringify(steps).includes('viewerUrl'), false);
});

test('the computer sheet places the loop list beside the live view', () => {
  const sheet = readFileSync(join(root, 'components/ComputerSheet.js'), 'utf8');
  const panel = readFileSync(join(root, 'components/LiveViewPanel.js'), 'utf8');
  const frame = readFileSync(join(root, 'lib/live-view.mjs'), 'utf8');
  const stage = sheet.slice(sheet.indexOf('browser-preview-stage'), sheet.indexOf('document.body'));
  assert.match(stage, /LoopSteps/);
  assert.match(stage, /LiveViewPanel/);
  assert.ok(stage.indexOf('LoopSteps') < stage.indexOf('LiveViewPanel'));
  assert.equal(panel.includes('LoopSteps'), false);
  assert.match(frame, /live\.browser\.run/);
  assert.match(frame, /\/ui\/view/);
  assert.match(frame, /\/ui\/inspector/);
  assert.equal(sheet.includes('viewerUrl'), false);
});
