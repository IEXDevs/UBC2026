import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VOICE_CLIENT_TOOLS,
  createVoiceClientTools,
  runVoiceClientTool,
  voiceToolDefinitions,
} from './voice-client-tools.mjs';
import { getDemoShellState } from './demo-state.mjs';

test('voice client tools open bots and confirm without spending', async () => {
  const state = getDemoShellState();
  let active = state.bots[0].id;
  let pane = 'Overview';
  const events = [];
  const tools = createVoiceClientTools({
    bots: state.bots,
    activeBotId: active,
    pane,
    setActiveBotId: (id) => { active = id; },
    setPane: (name) => { pane = name; },
    confirm: async () => true,
    pushEvent: (e) => events.push(e),
  });

  assert.deepEqual(VOICE_CLIENT_TOOLS.length, voiceToolDefinitions().length);
  const opened = await runVoiceClientTool(tools, 'open_bot', { name: 'Sandbox shopper' });
  assert.equal(opened.ok, true);
  assert.equal(active, 'bot_shop');
  assert.equal(pane, 'Main');

  const confirm = await tools.confirm_dialog({ prompt: 'Approve 1 USDC?', actionId: 'approve' });
  assert.equal(confirm.accepted, true);

  const read = await tools.read_back({ topic: 'overview' });
  assert.match(read.text, /3 bots/);
  assert.ok(events.some((e) => e.kind === 'client.open_bot'));

  const missing = await runVoiceClientTool(tools, 'nope', {});
  assert.equal(missing.error, 'unknown_tool');

  const locked = createVoiceClientTools({ bots: state.bots, locked: true, setActiveBotId: () => { active = 'changed'; } });
  const refused = await locked.open_bot({ name: 'Sandbox shopper' });
  assert.deepEqual(refused, { ok: false, error: 'desk_locked' });
  assert.equal(active, 'bot_shop');
});
