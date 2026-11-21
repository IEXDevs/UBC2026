/**
 * One agent turn for chat and for a voice handoff.
 * Voice speaks the reply. The agent and its subagents call the tools.
 */
import {
  HARNESS_TOOLS,
  SHARED_AGENT_TOOLS,
  harnessInstruction,
  normalizeSituation,
  parseSkillCommand,
  situationInstruction,
  skillById,
  skillForMessage,
  skillsCatalogInstruction,
  toOpenAiTools,
} from '@ubc2026/agent-tools';
import { chatToolsInstruction, createChatToolInvoker } from './chat-tools.mjs';
import { effectiveReviewCap, isFundTool, matchingToolGrant, needsBoundSpend, permissionInstruction, toolAccessKind, withDefaultBotId } from './spend-permission.mjs';
import { readSubagentResults, recordSubagentResult } from './subagent-board.mjs';
import { completeTextChat } from './text-chat.mjs';

const AMOUNT = /^(0|[1-9][0-9]{0,39})$/;

export function ownerReviewCap(value) {
  return typeof value === 'string' && AMOUNT.test(value) && value !== '0' ? value : null;
}

export function agentToolSchemas() {
  return toOpenAiTools([...SHARED_AGENT_TOOLS, ...HARNESS_TOOLS]);
}

export function harnessPrompt(_connectors, skillId = '', situation = null, now = new Date()) {
  const skill = skillById(skillId);
  const clock = situation && typeof situation.at === 'string'
    ? situation
    : normalizeSituation(situation, now);
  return [
    harnessInstruction(),
    situationInstruction(clock),
    skillsCatalogInstruction(),
    skill ? skill.instruction : '',
  ].filter(Boolean).join('\n');
}

/**
 * Attach the owner's permission to a spend tool call.
 * The model cannot raise the Review by AI cap. `confirmSpend` is only for a
 * text turn the owner already approved with the slide.
 */
export function stampSpendPermission(name, args, { permissionMode = 'ask', reviewCap = null, confirmSpend = false, grants = [], botId } = {}) {
  const next = withDefaultBotId(name, args && typeof args === 'object' && !Array.isArray(args) ? { ...args } : {}, botId);
  if (name === 'start_task') {
    if (permissionMode === 'full') next.ownerPermission = 'full';
    else delete next.ownerPermission;
  }
  if (isFundTool(name)) {
    next.permission = permissionMode === 'review' || permissionMode === 'full' ? permissionMode : 'ask';
    next.reviewCap = effectiveReviewCap(reviewCap);
    delete next.idempotencyKey;
    delete next.confirmed;
    if (confirmSpend && toolAccessKind(next.permission, name, next, next.reviewCap)) {
      if (needsBoundSpend(name, next)) {
        const grant = matchingToolGrant(grants, name, next, botId);
        if (grant) {
          next.idempotencyKey = grant.idempotencyKey;
          next.confirmed = true;
        }
      } else {
        next.confirmed = true;
      }
    }
  }
  return next;
}

export function linkedConnectorIds(value) {
  let source = value;
  if (typeof value === 'string') {
    try { source = JSON.parse(value); } catch { source = []; }
  }
  if (!Array.isArray(source)) return [];
  return source
    .filter(item => typeof item === 'string' && /^[a-z0-9-]{1,64}$/.test(item.trim().toLowerCase()))
    .map(item => item.trim().toLowerCase())
    .slice(0, 40);
}

/**
 * Turn `/vercel check the preview` into a task.
 * A normal message is returned unchanged.
 */
export function prepareOwnerTurn(message, connectors, situation = null, now = new Date()) {
  const clock = normalizeSituation(situation, now);
  const parsed = parseSkillCommand(message);
  if (!parsed) {
    const task = typeof message === 'string' ? message.trim() : '';
    if (!task) return { error: 'message_required' };
    const auto = skillForMessage(task);
    if (!auto) return { message: task, skillId: '', instruction: harnessPrompt(connectors, '', clock) };
    return {
      message: task,
      skillId: auto.id,
      autoSkill: true,
      instruction: `${harnessPrompt(connectors, auto.id, clock)}\nYou were attached automatically from plain words: open with one short line naming the skill (for example "Using ${auto.command} for this."), then work it.`,
    };
  }
  if (!parsed.task) {
    return { error: 'task_required', reply: `Add what ${parsed.command} should do.` };
  }
  return {
    message: parsed.task,
    skillId: parsed.id,
    instruction: harnessPrompt(connectors, parsed.id, clock),
  };
}

export async function dispatchHarness(name, args, ctx) {
  if (name === 'read_subagent_results') {
    return { ok: true, items: readSubagentResults(ctx.ownerId, ctx.botId) };
  }
  if (name === 'delegate_task') {
    if ((ctx.depth || 0) > 0) return { error: 'delegate_depth' };
    return runDelegatedAgent(ctx, args || {});
  }
  return null;
}

export async function runDelegatedAgent(ctx, args = {}) {
  const skill = skillById(typeof args.skill === 'string' ? args.skill : '');
  const task = typeof args.task === 'string' ? args.task.trim().slice(0, 2000) : '';
  if (!task) return { error: 'task_required' };
  if (typeof ctx.complete !== 'function' || typeof ctx.invokeRaw !== 'function') {
    return { error: 'agent_not_configured' };
  }
  let result;
  try {
    result = await ctx.complete({
      message: task,
      tools: agentToolSchemas(),
      toolsInstruction: [
        harnessPrompt(ctx.connectors, skill?.id || '', ctx.situation),
        'You are a subagent. Use the tools. Do not delegate. Reply with what you found.',
      ].join('\n'),
      maxToolRounds: 6,
      invokeTool: async (name, toolArgs) => {
        const hit = await dispatchHarness(name, toolArgs, { ...ctx, depth: (ctx.depth || 0) + 1 });
        if (hit) return hit;
        return ctx.invokeRaw(name, toolArgs);
      },
    });
  } catch (error) {
    const code = typeof error?.code === 'string' ? error.code : 'handoff_failed';
    recordSubagentResult({
      ownerId: ctx.ownerId,
      botId: ctx.botId,
      task,
      skill: skill?.id || '',
      reply: 'The subagent could not finish that step.',
      status: 'error',
    });
    return { error: code };
  }
  const reply = typeof result?.text === 'string' ? result.text.trim() : '';
  if (!reply) {
    recordSubagentResult({
      ownerId: ctx.ownerId,
      botId: ctx.botId,
      task,
      skill: skill?.id || '',
      reply: 'The subagent came back with nothing to report.',
      status: 'error',
    });
    return { error: 'empty_reply' };
  }
  const row = recordSubagentResult({
    ownerId: ctx.ownerId,
    botId: ctx.botId,
    task,
    skill: skill?.id || '',
    reply,
    activity: result?.activity,
    model: result?.model,
  });
  return { ok: true, reply, skill: skill?.id || null, subagents: row ? [row] : [] };
}

function clipReply(text) {
  const value = typeof text === 'string' ? text.trim() : '';
  if (!value) return 'The agent did not finish that.';
  return value.length > 1500 ? `${value.slice(0, 1500)}…` : value;
}

/**
 * Voice is the mouth. This runs the agent (and any subagent it delegates to)
 * with the shared tools, skills, and connected apps, then returns words to speak.
 */
export async function runVoiceAgentTurn({
  message,
  history = [],
  ownerId,
  botId,
  botName = 'Agent',
  botGoal = '',
  botType = 'trading',
  permissionMode = 'ask',
  reviewCap = null,
  connectors = [],
  situation = null,
  env = {},
  fetcher = fetch,
  metaModelApiKey = '',
  openrouterApiKey = '',
  model = '',
} = {}) {
  const desk = [];
  void connectors;
  const clock = normalizeSituation(situation);
  const prepared = prepareOwnerTurn(message, desk, clock, new Date(clock.at));
  if (prepared.reply) return { reply: prepared.reply, subagents: [] };
  if (!prepared.message) return { reply: 'Say what you want done.', subagents: [] };
  if (typeof ownerId !== 'string' || !ownerId || typeof botId !== 'string' || !botId) {
    return { reply: 'Open an agent, then start the call again.', subagents: [] };
  }
  const cap = ownerReviewCap(reviewCap);
  const spend = { permissionMode, reviewCap: cap, confirmSpend: false, botId };
  const invokeRaw = createChatToolInvoker({
    ownerId,
    botId,
    env,
    fetcher,
    searchFetch: fetcher,
    priceFetch: fetcher,
    rpcFetch: fetcher,
    situation: clock,
  });
  const ctx = {
    ownerId,
    botId,
    connectors: desk,
    situation: clock,
    permissionMode,
    depth: 0,
    invokeRaw: (name, args) => invokeRaw(name, stampSpendPermission(name, args, spend)),
    complete: (opts) => completeTextChat({
      metaModelApiKey,
      openrouterApiKey,
      botId,
      botName,
      botGoal,
      botType,
      history,
      permission: permissionInstruction(permissionMode),
      permissionMode,
      reviewCap: cap,
      model,
      fetcher,
      maxToolRounds: 6,
      ...opts,
    }),
  };
  let result;
  try {
    result = await ctx.complete({
      message: prepared.message,
      tools: agentToolSchemas(),
      toolsInstruction: [chatToolsInstruction(), prepared.instruction].join('\n'),
      invokeTool: async (name, args) => {
        const hit = await dispatchHarness(name, args, ctx);
        if (hit) return hit;
        return ctx.invokeRaw(name, args);
      },
    });
  } catch {
    return { reply: 'The agent could not take that. Try again in a moment.', subagents: [] };
  }
  const subagents = readSubagentResults(ownerId, botId);
  let reply = result?.hold?.prompt || result?.text || '';
  const latest = subagents[subagents.length - 1];
  if (latest && !reply.includes(latest.reply.slice(0, 48))) {
    reply = `${reply} Subagent said: ${latest.reply}`;
  }
  return { reply: clipReply(reply), subagents };
}
