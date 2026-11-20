/**
 * Tools for the agent and the subagents a voice handoff starts.
 * Voice itself speaks. These tools stay off the voice webhook list.
 */

function tool(name, description, required, properties) {
  return Object.freeze({
    name,
    description,
    parameters: Object.freeze({
      type: 'object',
      additionalProperties: false,
      required: Object.freeze([...required]),
      properties: Object.freeze({ ...properties }),
    }),
    voiceCalls: Object.freeze([]),
  });
}

export const HARNESS_TOOLS = Object.freeze([
  tool(
    'delegate_task',
    'Hand a subtask to a subagent. The subagent has the same tools and skills. It cannot hand work further. Use the reply, and read read_subagent_results if you need it again.',
    ['task'],
    {
      task: { type: 'string', description: 'What the subagent should do' },
      skill: { type: 'string', description: 'Optional skill id when the owner called that skill on this turn' },
    },
  ),
  tool(
    'read_subagent_results',
    'Read what subagents already returned for this agent. Does not start new work.',
    [],
    {},
  ),
]);

export const HARNESS_TOOL_NAMES = Object.freeze(HARNESS_TOOLS.map(item => item.name));

export function harnessInstruction() {
  return [
    'You can delegate_task and read_subagent_results.',
    'delegate_task is one level deep. A subagent cannot delegate again.',
    'When a subagent returns, say what it returned. Do not invent a second result.',
    'An owner situation may follow this note. Use its local time and place in search queries and browser pages when the ask depends on where or when they are.',
  ].join('\n');
}
