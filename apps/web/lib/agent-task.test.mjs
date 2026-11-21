import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_TASK_TOOL, GOAL_QUESTION, goalFromFirstMessage, proposedGeneralGoal, reviewGeneralGoal, taskFromRequest } from './agent-task.mjs';
import { buildTextChatMessages, completeTextChat } from './text-chat.mjs';

test('a concrete request changes the card task without interpreting confirmations as tasks', () => {
  assert.equal(taskFromRequest('Could you check my SOL balance?'), 'Check my SOL balance');
  assert.equal(taskFromRequest('/goal Compare current staking rates'), 'Compare current staking rates');
  assert.equal(taskFromRequest('yes, that works'), '');
  assert.equal(taskFromRequest('check'), '');
});

test('only accepting the active proposal changes the general goal', () => {
  const saved = { generalGoal: 'Track staking yields', currentTask: 'Compare USDC yields',
    goalProposal: { id: 'proposal', text: 'Track stablecoin yields' } };
  assert.equal(proposedGeneralGoal('Track staking yields.', saved.generalGoal), '');
  assert.equal(proposedGeneralGoal('Track stablecoin yields', saved.generalGoal, saved.goalProposal.text), '');
  assert.equal(reviewGeneralGoal(saved, 'stale-proposal', true), null);
  assert.deepEqual(reviewGeneralGoal(saved, 'proposal', false), { ...saved, goalProposal: null });
  assert.deepEqual(reviewGeneralGoal(saved, 'proposal', true), { ...saved, goalProposal: null, generalGoal: 'Track stablecoin yields' });
  assert.equal(saved.generalGoal, 'Track staking yields');
});

test('the general goal is context for the latest directive, and an unset goal prompts a question', () => {
  const messages = buildTextChatMessages({ botGoal: 'Track staking yields', message: 'Find the current SOL price', trackAgentTask: true });
  assert.match(messages[1].content, /background context: Track staking yields/);
  assert.match(messages[1].content, /latest directive for this turn/);
  assert.equal(messages.at(-1).content, 'Find the current SOL price');
  assert.ok(buildTextChatMessages({ message: 'Hi' })[1].content.includes(GOAL_QUESTION));
});

test('chat can return a new task and proposed goal without making a tool call outside the chat', async () => {
  let rounds = 0;
  const result = await completeTextChat({
    modelApiKey: 'LLM_mock_for_agent_task', botGoal: 'Track staking yields', trackAgentTask: true,
    message: 'Going forward, focus on stablecoin yields. Check USDC rates today.',
    invokeTool: async () => assert.fail('The task label must stay inside chat'),
    fetcher: async (_url, init) => {
      const { messages, tools } = JSON.parse(init.body);
      if (messages[0].content.includes('Kind: reply')) {
        return Response.json({ choices: [{ message: { content: '{"allow":true}' } }] });
      }
      if (++rounds === 1) {
        assert.equal(tools[0].function.name, AGENT_TASK_TOOL);
        return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{
          id: 'goal-call', type: 'function', function: {
            name: AGENT_TASK_TOOL,
            arguments: JSON.stringify({ task: 'Check USDC yields', proposedGoal: 'Track stablecoin yields' }),
          },
        }] } }] });
      }
      assert.equal(messages.at(-1).tool_call_id, 'goal-call');
      return Response.json({ choices: [{ message: { content: 'I’ll check the USDC rates.' } }] });
    },
  });
  assert.equal(result.agentTask, 'Check USDC yields');
  assert.equal(result.proposedGoal, 'Track stablecoin yields');
  assert.equal(result.text, 'I’ll check the USDC rates.');
  assert.equal(result.activity, undefined);
});

test(`a goal-free first Laso direction proposes card handling without interrogating`, () => {
  assert.equal(goalFromFirstMessage(`make me a laso card for $10`, ``), `Handle Laso card purchases`);
  assert.equal(goalFromFirstMessage(`make me a laso card for $10`, `Waiting for a goal.`), `Handle Laso card purchases`);
  assert.equal(goalFromFirstMessage(`make me a laso card for $10`, `Trade SOL`), ``);
  assert.equal(goalFromFirstMessage(`hello`, ``), ``);
  assert.equal(goalFromFirstMessage(``, ``), ``);
  assert.equal(goalFromFirstMessage(null, ``), ``);
});

test(`any recognizable card ask proposes card handling, plain chat stays free`, () => {
  assert.equal(goalFromFirstMessage(`get me a prepaid card for dominos`, ``), `Handle Laso card purchases`);
  assert.equal(goalFromFirstMessage(`top up $50 please`, ``), `Handle Laso card purchases`);
  assert.equal(goalFromFirstMessage(`buy a gift card`, ``), `Handle Laso card purchases`);
  assert.equal(goalFromFirstMessage(`check the price of SOL`, ``), ``);
  assert.equal(goalFromFirstMessage(`make me a laso card`, `Trade SOL`), ``);
});

test(`laso words with card context propose even before kind is known`, () => {
  assert.equal(goalFromFirstMessage(`make me a laso card for dominos`, ``), `Handle Laso card purchases`);
  assert.equal(goalFromFirstMessage(`laso kyc help`, ``), `Handle Laso card purchases`);
  assert.equal(goalFromFirstMessage(`laso`, ``), ``);
  assert.equal(goalFromFirstMessage(`hello`, `Trade SOL`), ``);
});
