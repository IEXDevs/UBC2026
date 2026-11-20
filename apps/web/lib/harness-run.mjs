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
  skillsCatalogInstruction,
  toOpenAiTools,
} from '@ubc2026/agent-tools';
import { devnetSpendAsset } from '@ubc2026/contracts';
import { chatToolsInstruction, createChatToolInvoker } from './chat-tools.mjs';
import { connectorInstruction, planConnectorUse, resolveDeskConnectors } from './connector-access.mjs';
import { effectiveReviewCap, grantCovers, isFundTool, permissionInstruction, toolAccessKind } from './spend-permission.mjs';
import { readSubagentResults, recordSubagentResult } from './subagent-board.mjs';
import { completeTextChat } from './text-chat.mjs';

const AMOUNT = /^(0|[1-9][0-9]{0,39})$/;

export function ownerReviewCap(value) {
  return typeof value === 'string' && AMOUNT.test(value) && value !== '0' ? value : null;
}

export function agentToolSchemas() {
  return toOpenAiTools([...SHARED_AGENT_TOOLS, ...HARNESS_TOOLS]);
}

export function harnessPrompt(connectors, skillId = '', situation = null, now = new Date()) {
  const skill = skillById(skillId);
  const clock = situation && typeof situation.at === 'string'
    ? situation
    : normalizeSituation(situation, now);
  return [
    harnessInstruction(),
    situationInstruction(clock),
    connectorInstruction(connectors),
    skillsCatalogInstruction(),
    skill ? skill.instruction : '',
  ].filter(Boolean).join('\n');
}

/**
 * Attach the owner's permission to a spend tool call.
 * The model cannot raise the Review by AI cap. `confirmSpend` is only for a
 * text turn the owner already approved with the slide.
 */
export function stampSpendPermission(name, args, { permissionMode = 'ask', reviewCap = null, confirmSpend = false, grants = [] } = {}) {
  const next = args && typeof args === 'object' && !Array.isArray(args) ? { ...args } : {};
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
      if (name === 'request_spend' && devnetSpendAsset(next.asset ?? 'USDC') !== 'USDC') {
        const grant = Array.isArray(grants) ? grants.find(item => grantCovers([item], name, next)) : null;
        if (/^spend_[0-9a-f-]{36}$/.test(grant?.idempotencyKey || '')) {
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
 * Turn `/vercel check the preview` into a task, or a reply when the app is off.
 * A normal message is returned unchanged.
 */
export function prepareOwnerTurn(message, connectors, situation = null, now = new Date()) {
  const clock = normalizeSituation(situation, now);
  const parsed = parseSkillCommand(message);
  if (!parsed) {
    const task = typeof message === 'string' ? message.trim() : '';
    return task
      ? { message: task, skillId: '', instruction: harnessPrompt(connectors, '', clock) }
      : { error: 'message_required' };
  }
  if (!parsed.task) {
    return { error: 'task_required', reply: `Add what ${parsed.command} should do.` };
  }
  if (parsed.needsConnector) {
    const linked = resolveDeskConnectors(connectors);
    if (!linked.some(row => row.id === parsed.needsConnector)) {
      return {
        error: 'connector_off',
        connector: parsed.needsConnector,
        reply: `Connect ${parsed.needsConnector} on the connectors page, then ask again.`,
      };
    }
  }
  return {
    message: parsed.task,
    skillId: parsed.id,
    instruction: harnessPrompt(connectors, parsed.id, clock),
  };
}

export async function dispatchHarness(name, args, ctx) {
  if (name === 'list_connectors') {
    return {
      ok: true,
      items: resolveDeskConnectors(ctx.connectors).map(row => ({ id: row.id, name: row.name, linked: true })),
    };
  }
  if (name === 'read_subagent_results') {
    return { ok: true, items: readSubagentResults(ctx.ownerId, ctx.botId) };
  }
  if (name === 'use_connector') {
    const plan = planConnectorUse(ctx.connectors, args || {});
    if (plan.error) return plan;
    if (!plan.tool || typeof ctx.invokeRaw !== 'function') {
      return { ok: true, connector: plan.connector, linked: true, automatic: false, hint: plan.hint };
    }
    const result = await ctx.invokeRaw(plan.tool, plan.args);
    return {
      ok: !result?.error,
      connector: plan.connector,
      automatic: true,
      routedTo: plan.tool,
      ...(plan.hint ? { hint: plan.hint } : {}),
      result,
    };
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
  if (skill?.needsConnector && !resolveDeskConnectors(ctx.connectors).some(row => row.id === skill.needsConnector)) {
    return {
      error: 'connector_off',
      connector: skill.needsConnector,
      hint: `Connect ${skill.needsConnector} on the connectors page.`,
    };
  }
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
      maxToolRounds: 3,
      invokeTool: async (name, toolArgs) => {
        const hit = await dispatchHarness(name, toolArgs, { ...ctx, depth: (ctx.depth || 0) + 1 });
        if (hit) return hit;
        return ctx.invokeRaw(name, toolArgs);
      },
    });
  } catch (error) {
    return { error: typeof error?.code === 'string' ? error.code : 'handoff_failed' };
  }
  const reply = typeof result?.text === 'string' ? result.text.trim() : '';
  if (!reply) return { error: 'empty_reply' };
  const row = recordSubagentResult({
    ownerId: ctx.ownerId,
    botId: ctx.botId,
    task,
    skill: skill?.id || '',
    reply,
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
  const desk = linkedConnectorIds(connectors);
  const clock = normalizeSituation(situation);
  const prepared = prepareOwnerTurn(message, desk, clock, new Date(clock.at));
  if (prepared.reply) return { reply: prepared.reply, subagents: [] };
  if (!prepared.message) return { reply: 'Say what you want done.', subagents: [] };
  if (typeof ownerId !== 'string' || !ownerId || typeof botId !== 'string' || !botId) {
    return { reply: 'Open an agent, then start the call again.', subagents: [] };
  }
  const cap = ownerReviewCap(reviewCap);
  const spend = { permissionMode, reviewCap: cap, confirmSpend: false };
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
      botName,
      botGoal,
      botType,
      history,
      permission: permissionInstruction(permissionMode),
      permissionMode,
      reviewCap: cap,
      model,
      fetcher,
      maxToolRounds: 3,
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
