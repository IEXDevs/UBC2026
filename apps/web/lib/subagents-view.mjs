/**
 * Subagent strip + modal view helpers (pure, no DOM).
 * Rows come from the chat route `subagents` field.
 */

export function visibleSubagents(rows, suggesting = false) {
  if (suggesting === true) return [];
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(row => row && typeof row.reply === 'string' && row.reply.trim())
    .map(row => ({
      id: typeof row.id === 'string' ? row.id : '',
      task: typeof row.task === 'string' ? row.task : '',
      skill: typeof row.skill === 'string' ? row.skill : '',
      reply: row.reply,
      activity: Array.isArray(row.activity) ? row.activity : [],
      model: typeof row.model === 'string' ? row.model : '',
      status: row.status === 'error' ? 'error' : 'done',
    }))
    .slice(-8);
}

export function subagentLabel(row) {
  const task = typeof row?.task === 'string' ? row.task.trim() : '';
  if (task) return task.length > 60 ? `${task.slice(0, 57)}…` : task;
  const skill = typeof row?.skill === 'string' ? row.skill.trim() : '';
  if (skill) return `/${skill}`;
  return 'Subagent';
}

export function mainAgentState(thinking = false) {
  return thinking === true ? 'working' : 'waiting';
}

/**
 * Board row → inline chat line. Renders in ChatBubbles where the subagent
 * was invoked, with the same trace + reply as the strip modal. Text only,
 * never voice.
 */
export function boardRowToLine(row, index = 0) {
  const task = typeof row?.task === 'string' ? row.task : '';
  const skill = typeof row?.skill === 'string' ? row.skill : '';
  return {
    id: `sub-line-${typeof row?.id === 'string' && row.id ? row.id : index}`,
    role: 'agent',
    text: typeof row?.reply === 'string' ? row.reply : '',
    activity: Array.isArray(row?.activity) ? row.activity : [],
    subagent: {
      task,
      skill,
      status: row?.status === 'error' ? 'error' : 'done',
      ref: Number.isSafeInteger(index) ? index : 0,
    },
  };
}
