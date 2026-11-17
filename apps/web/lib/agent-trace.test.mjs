import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserTrace, callStatus, clipTrace, traceModel } from './agent-trace.mjs';

test('a live trace groups tools and drops empty input', () => {
  assert.deepEqual(traceModel(null), { chips: [], sections: [] });
  const trace = traceModel([
    { id: 'a', kind: 'tool.call', summary: 'Firecrawl research: pool snapshot' },
    { id: 'b', kind: 'verify.mismatch', summary: 'Price still differs' },
    { id: 'c', kind: 'tool.call', summary: 'x'.repeat(80) },
  ]);
  assert.equal(trace.chips.length, 2);
  assert.equal(trace.chips[0].icon, 'terminal');
  assert.equal(trace.chips[0].status, 'done');
  assert.equal(callStatus('verify.mismatch'), 'error');
  assert.equal(trace.sections[0].label, 'Tool');
  assert.equal(trace.sections[0].children.length, 2);
  assert.equal(trace.sections[1].children[0].label, 'Price still differs');
  assert.ok(clipTrace('x'.repeat(80), 42).length <= 42);
});

test('an open browser session is one chip and drops a generic purpose', () => {
  const quiet = browserTrace([{ sessionRecordId: 'rec_closed', status: 'closed', purpose: 'browse' }]);
  assert.deepEqual(quiet, { chips: [], section: null });
  const live = browserTrace([
    { sessionRecordId: 'rec_1', status: 'open', purpose: 'browse' },
    { sessionRecordId: 'rec_2', status: 'open', purpose: 'search' },
  ]);
  assert.equal(live.chips.length, 1);
  assert.equal(live.chips[0].name, 'Browser');
  assert.equal(live.chips[0].status, 'running');
  assert.equal(live.chips[0].argument, '2 open');
  assert.equal(live.section, null);
  assert.equal(live.chips[0].argument.includes('browse'), false);
  assert.equal(live.chips[0].argument.includes('search'), false);
  const named = browserTrace([{ sessionRecordId: 'rec_1', status: 'open', purpose: 'Circle rates' }]);
  assert.equal(named.chips[0].argument, 'Circle rates');
  assert.equal(JSON.stringify(named).includes('http'), false);
});
