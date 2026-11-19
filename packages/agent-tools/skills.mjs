/**
 * Harness skills the owner can start from chat with /goal and the same
 * commands. The text is instruction for the agent. It is not a second policy.
 */

export const AGENT_SKILLS = Object.freeze([
  Object.freeze({
    id: 'goal',
    command: '/goal',
    title: 'Goal',
    source: 'aihero.dev',
    needsConnector: null,
    description: 'Pursue one goal with the tools until it is done or blocked.',
    instruction: [
      'Skill /goal, in the style of an aihero.dev harness.',
      'The owner text after /goal is the only job.',
      'Use search, the browser, list_connectors, and use_connector.',
      'Connected apps are already on for this agent and for any subagent you delegate to.',
      'Stop when the goal is done, or name the one blocker.',
      'Do not spend unless the permission line allows that spend.',
    ].join('\n'),
  }),
  Object.freeze({
    id: 'aihero',
    command: '/aihero',
    title: 'AI Hero',
    source: 'aihero.dev',
    needsConnector: null,
    description: 'Plan, act with tools, and report the result.',
    instruction: [
      'Skill /aihero from aihero.dev.',
      'State the plan in one short sentence, then use tools.',
      'Delegate a subtask with delegate_task when a second agent should do it.',
      'Read read_subagent_results before you tell the owner what a subagent found.',
      'Finish with what happened and what is still open.',
    ].join('\n'),
  }),
  Object.freeze({
    id: 'vercel',
    command: '/vercel',
    title: 'Vercel',
    source: 'vercel',
    needsConnector: 'vercel',
    description: 'Work a Vercel question with the Vercel app connected.',
    instruction: [
      'Skill /vercel.',
      'The Vercel app must be connected. If it is not, say so and stop.',
      'Use use_connector with connectorId vercel, then the browser if a page has to be opened.',
      'Do not say a deploy finished unless the tool result says that action completed.',
    ].join('\n'),
  }),
  Object.freeze({
    id: 'github',
    command: '/github',
    title: 'GitHub',
    source: 'github',
    needsConnector: 'github',
    description: 'Look through GitHub with the GitHub app connected.',
    instruction: [
      'Skill /github.',
      'The GitHub app must be connected. If it is not, say so and stop.',
      'Use use_connector with connectorId github for the owner request.',
      'Do not say an issue or pull request was changed unless the tool result says that action completed.',
    ].join('\n'),
  }),
  Object.freeze({
    id: 'search',
    command: '/search',
    title: 'Search',
    source: 'firecrawl',
    needsConnector: null,
    description: 'Search the web, then read one page.',
    instruction: [
      'Skill /search.',
      'Call web_search once. If a result has a real https URL, call web_scrape on that URL.',
      'Answer from those results. Do not invent pages.',
    ].join('\n'),
  }),
]);

const SKILL_BY_ID = new Map(AGENT_SKILLS.map(skill => [skill.id, skill]));

export function skillById(id) {
  return typeof id === 'string' ? SKILL_BY_ID.get(id.trim().toLowerCase()) || null : null;
}

/**
 * `/goal ship the header` → the goal skill and the task text.
 * A normal sentence stays null so the agent answers it as chat.
 */
export function parseSkillCommand(message) {
  const text = typeof message === 'string' ? message.trim() : '';
  const match = /^\/([a-z0-9-]+)(?:\s+([\s\S]*))?$/i.exec(text);
  if (!match) return null;
  const skill = skillById(match[1]);
  if (!skill) return null;
  const task = typeof match[2] === 'string' ? match[2].trim() : '';
  return { id: skill.id, command: skill.command, task, needsConnector: skill.needsConnector, instruction: skill.instruction };
}

export function skillInstruction(id) {
  const skill = skillById(id);
  return skill ? skill.instruction : '';
}

export function skillsCatalogInstruction() {
  const names = AGENT_SKILLS.map(skill => `${skill.command} (${skill.description})`).join('; ');
  return `The owner can start a skill with ${names}. Follow that skill when the message uses its command.`;
}
