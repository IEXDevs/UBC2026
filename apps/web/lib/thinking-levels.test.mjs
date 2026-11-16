import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseThinkingCatalog, reasoningEffortFor, thinkingLevelsForModel } from './thinking-levels.mjs';

test('contributor spark has no Max and defaults to High', () => {
  const levels = thinkingLevelsForModel('muse-spark-1.3-contributor');
  assert.deepEqual(levels.map(item => item.label), ['Minimal', 'Low', 'Medium', 'High', 'Extra']);
  assert.equal(levels.find(item => item.default).id, 'high');
  assert.equal(reasoningEffortFor('muse-spark-1.3-contributor', 'Max'), 'high');
  assert.equal(reasoningEffortFor('muse-spark-1.3-contributor', 'Low'), 'low');
});

test('wonder includes Max and a catalog row can override the list', () => {
  const wonder = thinkingLevelsForModel('muse-wonder-1.0');
  assert.equal(wonder.at(-1).id, 'max');
  assert.equal(wonder.find(item => item.default).id, 'max');
  const catalog = parseThinkingCatalog({
    data: [
      { id: 'muse-spark-1.3-contributor', name: 'Muse Spark' },
      {
        id: 'muse-wonder-1.0',
        name: 'Muse Wonder',
        reasoning: { effort: ['low', 'high', 'max'], default: 'low' },
      },
    ],
  });
  assert.equal(catalog[0].levels.find(item => item.default).label, 'High');
  assert.deepEqual(catalog[1].levels.map(item => item.id), ['low', 'high', 'max']);
  assert.equal(catalog[1].levels.find(item => item.default).id, 'low');
});
