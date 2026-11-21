export const GOAL_QUESTION = 'What goal would you like me to work toward?';
export const AGENT_TASK_TOOL = 'describe_agent_task';

export const agentTaskTool = {
  type: 'function',
  function: {
    name: AGENT_TASK_TOOL,
    description: 'Describe this turn’s task for the agent card. Include a proposed general goal only when the owner indicates a lasting change in direction. This tool cannot change the general goal.',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'A brief action phrase, up to eight words.' },
        proposedGoal: { type: 'string', description: 'Optional short description of the new long-term direction.' },
      },
      required: ['task'],
      additionalProperties: false,
    },
  },
};

export function hasGeneralGoal(goal) {
  return typeof goal === 'string' && Boolean(goal.trim()) && !/^waiting for a goal\.?$/i.test(goal.trim());
}

export function taskLabel(value) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '');
  if (!text || /https?:\/\/|\[redacted\]/i.test(text)) return '';
  if (text.length <= 80) return text;
  return text.slice(0, 80).replace(/\s+\S*$/, '').trimEnd();
}

export function taskFromRequest(message) {
  if (typeof message !== 'string') return '';
  const request = message.trim().replace(/^\/goal\s+/i, '')
    .replace(/^(?:please\s+|(?:can|could|would|will) you\s+|i (?:want|need) you to\s+)+/i, '');
  if (!/^(?:build|buy|check|compare|create|explain|find|help|look|make|monitor|pay|research|review|sell|send|show|summarize|swap|track|transfer|update|write)\b\s+\S/i.test(request)) return '';
  const label = taskLabel(request);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function proposedGeneralGoal(candidate, current, pending) {
  const goal = taskLabel(candidate);
  if (!hasGeneralGoal(goal)) return '';
  if (goal.toLowerCase() === taskLabel(current).toLowerCase() || goal.toLowerCase() === taskLabel(pending).toLowerCase()) return '';
  return goal;
}

export function reviewGeneralGoal(saved, proposalId, accept) {
  const proposal = saved?.goalProposal;
  const goal = taskLabel(proposal?.text);
  if (!goal || proposal.id !== proposalId) return null;
  return { ...saved, goalProposal: null, ...(accept ? { generalGoal: goal } : {}) };
}
