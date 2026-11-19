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
    'list_connectors',
    'List the apps connected for this owner. Built-in apps stay on. The owner connects the rest once on the connectors page, and every agent and subagent sees that same set.',
    [],
    {},
  ),
  tool(
    'use_connector',
    'Use one connected app. Search and browser apps run automatically. Other connected apps run their automatic lookup. If the app is not connected, say so. Do not claim a post, mail, or deploy finished unless the result says that action completed.',
    ['connectorId'],
    {
      connectorId: { type: 'string', description: 'Connector id, such as vercel, github, or firecrawl' },
      query: { type: 'string', description: 'What to look up' },
      url: { type: 'string', description: 'https URL when the app should open a page' },
    },
  ),
  tool(
    'delegate_task',
    'Hand a subtask to a subagent. The subagent has the same tools, skills, and connected apps. It cannot hand work further. Use the reply, and read read_subagent_results if you need it again.',
    ['task'],
    {
      task: { type: 'string', description: 'What the subagent should do' },
      skill: { type: 'string', description: 'Optional skill id: goal, aihero, vercel, github, or search' },
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
    'You can list_connectors, use_connector, delegate_task, and read_subagent_results.',
    'Connected apps are shared. A voice handoff uses this same set.',
    'delegate_task is one level deep. A subagent cannot delegate again.',
    'When a subagent returns, say what it returned. Do not invent a second result.',
  ].join('\n');
}
