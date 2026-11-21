/**
 * Harness skills the owner can start from chat with /goal and the same
 * commands. The text is instruction for the agent. It is not a second policy.
 *
 * Skills in ./available stay out of this catalog. They enter a turn only
 * when the owner calls that command.
 */
import { AVAILABLE_SKILLS as availableSkillList } from './available-skills.mjs';

export const AVAILABLE_SKILLS = availableSkillList;

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
      'Use search and the browser.',
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
    needsConnector: null,
    description: 'Look up a Vercel question on the web.',
    instruction: [
      'Skill /vercel.',
      'Call web_search for the owner request. Open a result with the browser only when a page has to be read.',
      'Do not say a deploy finished unless a tool result says that action completed.',
    ].join('\n'),
  }),
  Object.freeze({
    id: 'github',
    command: '/github',
    title: 'GitHub',
    source: 'github',
    needsConnector: null,
    description: 'Look through GitHub on the web.',
    instruction: [
      'Skill /github.',
      'Call web_search for the owner request.',
      'Do not say an issue or pull request was changed unless a tool result says that action completed.',
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

const SKILL_BY_ID = new Map([
  ...AVAILABLE_SKILLS.map(skill => [skill.id, skill]),
  ...AGENT_SKILLS.map(skill => [skill.id, skill]),
]);

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

/**
 * Plain-word intent match so the owner never has to type a /command.
 * A Laso card ask in any words attaches the /laso-cards playbook.
 * Explicit /commands still win: this only runs when there is none.
 * Mirror of shopping/laso-card.mjs mentionsReloadable — keep in sync.
 */
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

function mentionsReloadable(message) {
  const words = String(message ?? '').toLowerCase().match(/[a-z]+/g) || [];
  return words.some(word =>
    word.length >= 7 && word.length <= 11 && /^(relo|rela|rea)/.test(word) && editDistance(word, 'reloadable') <= 3
  );
}

const LASO_INTENT = /\blaso\b|\blasso\b|\bnon[\s-]?reloadable\b|\bprepaid cards?\b|\btop[\s-]?up\b|\badd\s*funds\b|\bfund\s+(?:the\s|my\s)?card\b|\breload\s+(?:the\s|my\s)?card\b|\bgift\s*cards?\b/i;

export function skillForMessage(message) {
  const text = typeof message === 'string' ? message : '';
  if (!text.trim()) return null;
  if (LASO_INTENT.test(text) || mentionsReloadable(text)) return SKILL_BY_ID.get('laso-cards') || null;
  return null;
}

export function skillsCatalogInstruction() {
  const names = AGENT_SKILLS.map(skill => `${skill.command} (${skill.description})`).join('; ');
  return `The owner can start a skill with ${names}. Follow that skill when the message uses its command. A skill whose request is obvious from plain words arrives attached automatically with skillId set — say so in one short line, then work it. Other skills stay out of this prompt.`;
}
