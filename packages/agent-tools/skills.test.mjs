import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_SKILLS,
  parseSkillCommand,
  skillById,
  skillInstruction,
  skillsCatalogInstruction,
} from './skills.mjs';
import { HARNESS_TOOL_NAMES, harnessInstruction } from './harness.mjs';

/**
 * Achieves: slash skills resolve to a known harness and leave normal chat alone.
 * Fails when: /goal loses its task, /vercel forgets the connector, or a sentence becomes a skill.
 * Oracle: parseSkillCommand fixtures.
 * Side effects: none.
 */
test('slash skills parse to the harness and ignore normal chat', () => {
  assert.deepEqual(
    AGENT_SKILLS.map(skill => skill.id),
    ['goal', 'aihero', 'vercel', 'github', 'search'],
  );
  const goal = parseSkillCommand('/goal ship the header');
  assert.equal(goal.id, 'goal');
  assert.equal(goal.task, 'ship the header');
  assert.equal(goal.needsConnector, null);
  assert.match(skillInstruction('goal'), /aihero\.dev/);
  const vercel = parseSkillCommand('/vercel  check the preview');
  assert.equal(vercel.needsConnector, 'vercel');
  assert.equal(vercel.task, 'check the preview');
  assert.equal(parseSkillCommand('ship the header'), null);
  assert.equal(parseSkillCommand('/nope do a thing'), null);
  assert.equal(skillById('search').command, '/search');
  assert.match(skillsCatalogInstruction(), /\/goal/);
  assert.match(harnessInstruction(), /delegate_task/);
  assert.ok(HARNESS_TOOL_NAMES.includes('use_connector'));
  assert.ok(HARNESS_TOOL_NAMES.includes('read_subagent_results'));
});
