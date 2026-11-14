import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BOT_PAGE_SECTIONS,
  buildApprovalPreview,
  buildBotPage,
  demoBotExperiences,
  eventsUrl,
  formatBaseUnits,
  raisedCap,
  timelineEntries,
  whyExplanation,
} from './bot-experience.mjs';
import { getDemoShellState } from './demo-state.mjs';

test('approval preview is the first bot-page section', () => {
  const experience = demoBotExperiences().bot_meteora;
  const page = buildBotPage({ botId: 'bot_meteora', ...experience });
  assert.deepEqual(page.sections.map(section => section.id), [...BOT_PAGE_SECTIONS]);
  assert.equal(page.sections[0].id, 'approval-preview');
  assert.equal(page.sections[0].preview.state, 'approval-needed');
  assert.deepEqual(page.sections[0].preview.actions, ['approve']);
  assert.equal(page.sections[0].preview.outflowLabel, '5 USDC');
  assert.equal(page.sections[0].preview.recipient, 'alex.sol');
  assert.equal(page.sections[0].preview.cluster, 'devnet');
  assert.equal(page.sections[1].entries[0].kind, 'approval.requested');
  assert.equal(page.sections[3].why.showsChainOfThought, false);
  assert.equal(page.sections[3].why.memo.includes(experience.decision.decisionDigest), true);
});

test('over-budget preview offers approve once or raise limit', () => {
  const preview = buildApprovalPreview(demoBotExperiences().bot_shop.preview);
  assert.equal(preview.state, 'over-budget');
  assert.deepEqual(preview.actions, ['approve-once', 'raise-limit']);
  assert.equal(preview.actions.includes('approve'), false);
  assert.deepEqual(preview.violations, ['per-transaction']);
  assert.deepEqual(raisedCap('trading', preview.currentCap, {
    maxOutflow: '50000000',
    maxPerTransaction: '4000000',
  }), { ok: false, reason: 'cannot-lower-limit' });
  assert.equal(raisedCap('trading', preview.currentCap, {
    maxOutflow: '80000000',
    maxPerTransaction: '15000000',
  }).ok, true);
});

test('timeline is newest first and drops live-view secrets and hidden reasoning', () => {
  const events = [
    ...demoBotExperiences().bot_meteora.events,
    {
      id: 'evt_leak',
      botId: 'bot_meteora',
      ownerId: 'demo_owner',
      kind: 'tool.call',
      summary: 'Open https://live.browser.run/ui/view?jwt=eyJhbGciOiJub25lIn0.secret viewerUrl',
      at: 1763100300000,
    },
    {
      id: 'evt_other',
      botId: 'bot_shop',
      ownerId: 'demo_owner',
      kind: 'tool.call',
      summary: 'Other bot',
      at: 1763100400000,
    },
    {
      id: 'evt_thought',
      botId: 'bot_meteora',
      ownerId: 'demo_owner',
      kind: 'tool.call',
      summary: 'chain-of-thought: secret plan',
      at: 1763100200000,
    },
  ];
  const entries = timelineEntries(events, 'bot_meteora');
  assert.equal(entries[0].id, 'evt_leak');
  assert.equal(entries[0].summary.includes('http'), false);
  assert.equal(entries[0].summary.includes('eyJ'), false);
  assert.equal(entries[0].summary.includes('viewerUrl'), false);
  assert.equal(entries.some(entry => entry.id === 'evt_other'), false);
  assert.equal(entries.find(entry => entry.id === 'evt_thought').summary.includes('chain-of-thought'), false);
  assert.deepEqual(entries.map(entry => entry.at), [...entries.map(entry => entry.at)].sort((a, b) => b - a));
});

test('why view uses the decision record and hides a mismatched memo', () => {
  const decision = {
    ...demoBotExperiences().bot_positions.decision,
    memo: JSON.stringify({ v: 1, o: 'c', d: 'a'.repeat(64), r: 'b'.repeat(64) }),
    chainOfThought: 'do not show',
  };
  const why = whyExplanation(decision, demoBotExperiences().bot_positions.events);
  assert.equal(why.showsChainOfThought, false);
  assert.equal(JSON.stringify(why).includes('do not show'), false);
  assert.equal(why.memo, null);
  assert.match(why.lines.join(' '), /does not match|unsigned|mismatch/);
  assert.equal(why.related.some(entry => entry.kind === 'verify.mismatch'), true);
});

test('incomplete preview cannot be approved', () => {
  const blocked = buildApprovalPreview({ state: 'approval-needed', outflow: '1' });
  assert.equal(blocked.state, 'blocked');
  assert.deepEqual(blocked.actions, []);
  assert.equal(buildApprovalPreview(null).state, 'clear');
  assert.equal(formatBaseUnits('1000000', 'USDC'), '1 USDC');
});

test('event polling stays on the runtime origin', () => {
  assert.equal(
    eventsUrl('https://runtime.example/agent/', 'bot_meteora'),
    'https://runtime.example/agent/api/events?botId=bot_meteora',
  );
  assert.equal(eventsUrl('javascript:alert(1)', 'bot_meteora'), null);
  assert.equal(eventsUrl('', 'bot_meteora'), null);
});

test('demo shell bots carry a bot page and money panes stay empty placeholders', () => {
  const state = getDemoShellState();
  for (const bot of state.bots) {
    const page = buildBotPage({ botId: bot.id, ...bot.experience });
    assert.equal(page.sections[0].id, 'approval-preview');
    assert.equal(bot.payments, undefined);
    assert.equal(bot.positions, undefined);
    assert.equal(bot.walletPage, undefined);
  }
  const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../app/page.js'), 'utf8');
  assert.match(page, /pane === 'Agents'/);
  assert.match(page, /BotPage/);
  assert.match(page, /panePlaceholder\(pane\)/);
  assert.equal(page.includes('Payments feed'), false);
  assert.equal(page.includes('Wallet page'), false);
});
