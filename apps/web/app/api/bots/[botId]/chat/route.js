import { accessTokenFromRequest } from '../../../../../lib/privy-cookie-session.mjs';
import { parseLasoBrowserPayment } from '../../../../../../agent-runtime/src/laso-browser-payment.mjs';
import { swapFailure } from '../../../../../lib/swap-failure.mjs';
import { createHmac } from 'node:crypto';
import {
  parsePermissionedSpendBody, parseSpendApprovalTerms, parseSpendAuthorizationSignature, spendApprovalMessage,
} from '@ubc2026/contracts';
import { verifyPrivyAccessToken } from '../../../../../lib/privy-access-token.mjs';
import { formatBaseUnits, shortAddress } from '../../../../../lib/money-views.mjs';
import { readRootEnv } from '../../../../../lib/root-env.mjs';
import {
  chatToolsInstruction,
  createChatToolInvoker,
  serializeToolResult,
} from '../../../../../lib/chat-tools.mjs';
import { fetchAgentRuntime } from '../../../../../lib/runtime-fetch.mjs';
import { completeTextChat, TextChatError } from '../../../../../lib/text-chat.mjs';
import { amountOverReviewCap, effectiveReviewCap, parsePermission, permissionInstruction } from '../../../../../lib/spend-permission.mjs';
import {
  agentToolSchemas,
  dispatchHarness,
  ownerReviewCap,
  prepareOwnerTurn,
  stampSpendPermission,
} from '../../../../../lib/harness-run.mjs';
import { situationFromEdge } from '@ubc2026/agent-tools';
import { visitorGeo } from '../../../../../lib/visitor-geo.mjs';
import { readSubagentResults } from '../../../../../lib/subagent-board.mjs';
import { MESSAGE_CHAR_CAP } from '../../../../../lib/context-usage.mjs';
import { ensureOwnerTradeLoop, ownerAsksForOneTrade, pendingSwapHold } from '../../../../../lib/owner-trade.mjs';
import { modelFreeCommand } from '../../../../../lib/model-free-command.mjs';
import { cloudflareWorkerEnv } from '../../../../../lib/wallets-cloudflare.mjs';
import { parseSolHandleSend, runSolHandleSend } from '../../../../../lib/sol-handle-send.mjs';
import {
  isAssetSpendHold,
  resumeAssetSpend,
  sealAssetSpendHold,
  swapHoldFromPreview,
} from '../../../../../lib/chat-spend-confirmation.mjs';

const BOT_ID = /^[a-zA-Z0-9:_-]{1,128}$/;
const OWNER = /^[a-zA-Z0-9:_.-]{1,256}$/;

function secretFrom(cfEnv, name) {
  const fromCf = typeof cfEnv?.[name] === 'string' ? cfEnv[name].trim() : '';
  if (fromCf) return fromCf;
  const fromRoot = readRootEnv(name);
  if (fromRoot) return fromRoot;
  return typeof process.env[name] === 'string' ? process.env[name].trim() : '';
}

function budgetApprovalReply(hold, gate, approvalContext) {
  const terms = parseSpendApprovalTerms(gate?.approvalTerms);
  const { action, asset, handle, destination, amount } = hold.args;
  if (hold.budgetOverride || action !== 'spend' || asset !== 'SOL'
    || (!handle && !destination) || !destination || !terms || gate.signed !== false
    || (gate.error || gate.state) !== 'approval-needed' || gate.reason !== 'per-transaction') return null;
  const who = handle ? `@${handle} (${shortAddress(destination)})` : shortAddress(destination);
  const label = `Approve once: send ${formatBaseUnits(amount, 9)} SOL to ${who} plus a ${formatBaseUnits(terms.feeLamports, 9)} SOL fee.`;
  const prompt = `${label} This overrides the agent’s per-transfer limit and, if needed, its remaining budget for this payment only. The limits won’t change. Slide to approve once.`;
  const resealed = sealAssetSpendHold({ ...hold, budgetOverride: terms, label, prompt }, approvalContext);
  return { provider: 'desk', toolRounds: 1, text: prompt, hold: resealed };
}

async function chatToolEnv() {
  const cfEnv = await cloudflareWorkerEnv();
  return {
    FIRECRAWL_API_KEY: secretFrom(cfEnv, 'FIRECRAWL_API_KEY'),
    CLOUDFLARE_ACCOUNT_ID: secretFrom(cfEnv, 'CLOUDFLARE_ACCOUNT_ID'),
    CLOUDFLARE_API_TOKEN: secretFrom(cfEnv, 'CLOUDFLARE_API_TOKEN'),
    // Text-chat get_wallets enriches shell wallet addresses via QuickNode when
    // Supabase rows are missing — same secret the Worker uses. Prefer the
    // Cloudflare binding over root .env so hosted OpenNext sees the secret.
    SOLANA_RPC_URL: secretFrom(cfEnv, 'SOLANA_RPC_URL'),
    QUICKNODE_MAINNET_RPC_URL: secretFrom(cfEnv, 'QUICKNODE_MAINNET_RPC_URL'),
    QUICKNODE_TESTNET_RPC_URL: secretFrom(cfEnv, 'QUICKNODE_TESTNET_RPC_URL'),
    JUPITER_API_KEY: secretFrom(cfEnv, 'JUPITER_API_KEY'),
    NEXT_PUBLIC_AGENT_RUNTIME_URL: secretFrom(cfEnv, 'NEXT_PUBLIC_AGENT_RUNTIME_URL'),
    PRIVY_APP_ID: secretFrom(cfEnv, 'PRIVY_APP_ID') || secretFrom(cfEnv, 'NEXT_PUBLIC_PRIVY_APP_ID'),
    SUPABASE_SERVICE_ROLE_KEY: secretFrom(cfEnv, 'SUPABASE_SERVICE_ROLE_KEY'),
  };
}

export async function POST(request, context) {
  const params = await context?.params;
  const botId = typeof params?.botId === 'string' ? params.botId : '';
  if (!BOT_ID.test(botId)) {
    return Response.json({ error: 'invalid_bot' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  const ownerHeader = request.headers.get('x-owner-id');
  if (typeof ownerHeader !== 'string' || !OWNER.test(ownerHeader.trim())) {
    return Response.json({ error: 'owner_required' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  const ownerId = ownerHeader.trim();

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) {
    return Response.json({ error: 'message_required' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  if (message.length > MESSAGE_CHAR_CAP) {
    return Response.json({ error: 'message_too_long' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  const permissionMode = parsePermission(body.permission);
  const reviewCap = ownerReviewCap(body.reviewCap);
  const grants = Array.isArray(body.grants)
    ? body.grants.slice(0, 4).filter(item => item && typeof item.name === 'string')
    : [];
  const assetConfirmation = grants.find(isAssetSpendHold);
  const moveAuthorization = body.moveAuthorization;
  if (moveAuthorization !== undefined && (!assetConfirmation || !['spend', 'pay'].includes(assetConfirmation.args?.action ?? 'spend')
      || body.spendAuthorization !== undefined || body.lasoPayment !== undefined)) {
    return Response.json({ error: 'invalid_spend_authorization' }, { status: 400 });
  }
  const lasoPayment = parseLasoBrowserPayment(body.lasoPayment);
  if (body.lasoPayment !== undefined && (assetConfirmation?.args?.action !== 'x402'
      || !lasoPayment || lasoPayment.phase === 'prepared' || body.spendAuthorization !== undefined)) {
    return Response.json({ error: 'invalid_laso_payment' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  if (assetConfirmation?.args?.action === 'x402' && !lasoPayment) {
    return Response.json({ error: 'browser_wallet_required' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const spendAuthorization = body.spendAuthorization === 'prepare'
    ? 'prepare' : parseSpendAuthorizationSignature(body.spendAuthorization);
  if (body.spendAuthorization !== undefined && (!assetConfirmation || !spendAuthorization)) {
    return Response.json({ error: 'invalid_spend_authorization' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const solSend = assetConfirmation ? null : parseSolHandleSend(message);
  const reviewSwap = !assetConfirmation && modelFreeCommand(message) === 'review-swap';
  const noModel = solSend || assetConfirmation || reviewSwap;
  const connectors = [];
  const situation = noModel ? null : situationFromEdge(body.situation, await visitorGeo(request));
  const prepared = situation ? prepareOwnerTurn(message, connectors, situation, new Date(situation.at)) : null;
  if (prepared?.reply) {
    return Response.json(
      { ok: true, botId, reply: prepared.reply, provider: 'desk', toolRounds: 0 },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const accessToken = accessTokenFromRequest(request)
    || (typeof body.accessToken === 'string' ? body.accessToken.trim() : '');
  const env = await chatToolEnv();
  const invokeRaw = createChatToolInvoker({
    ownerId,
    botId,
    env,
    runtimeBase: env.NEXT_PUBLIC_AGENT_RUNTIME_URL,
    shellBots: Array.isArray(body.shellBots) ? body.shellBots.slice(0, 40) : null,
    shellWallets: Array.isArray(body.shellWallets) ? body.shellWallets.slice(0, 40) : null,
    shellBalanceLabel: typeof body.shellBalanceLabel === 'string' ? body.shellBalanceLabel : null,
    accessToken,
    ownerMessage: message,
    deskGrant: /^[0-9a-f]{64}$/.test(request.headers.get('x-desk-grant') || '')
      ? request.headers.get('x-desk-grant')
      : '',
    fetcher: async (url, init) => {
      if (noModel) {
        const options = init?.method === 'GET' ? { ...init, signal: AbortSignal.timeout(8000) } : init;
        return fetchAgentRuntime(url, options);
      }
      try {
        return await fetchAgentRuntime(url, init);
      } catch {
        return fetch(url, init);
      }
    },
    // Price hosts must not ride the runtime service binding. A 404 from the
    // Worker is not a DexScreener outage.
    priceFetch: fetch,
    // Firecrawl must not ride the runtime service binding. A Worker 404 is
    // not a research outage.
    searchFetch: fetch,
    // Solana JSON-RPC must not ride AGENT_RUNTIME either — binding.fetch(RPC)
    // returns a Worker 404 and collapses into rpc_failed.
    rpcFetch: fetch,
    situation,
  });
  const spend = { permissionMode, reviewCap, confirmSpend: true, grants, botId };
  const metaModelApiKey = readRootEnv('META_MODEL_API_KEY');
  const openrouterApiKey = readRootEnv('OPENROUTER_API_KEY');
  const approvalContext = {
    ownerId,
    botId,
    secret: metaModelApiKey || openrouterApiKey,
    ...(env.SUPABASE_SERVICE_ROLE_KEY && env.PRIVY_APP_ID ? {
      async attestBudgetApproval(hold, terms) {
        let session;
        try {
          session = await verifyPrivyAccessToken(accessToken, {
            appId: env.PRIVY_APP_ID,
            fetcher: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(8000) }),
          });
        } catch {
          throw new TextChatError('login_required', 401);
        }
        const spend = parsePermissionedSpendBody({
          ...hold.args, permission: 'ask', idempotencyKey: hold.idempotencyKey, confirmed: true,
        });
        if (session.sub !== ownerId || !spend || spend.botId !== botId) throw new TextChatError('login_required', 401);
        const expiresAt = hold.expiresAt;
        const binding = spendApprovalMessage({ ownerId, spend, terms, expiresAt });
        const mac = createHmac('sha256', env.SUPABASE_SERVICE_ROLE_KEY).update(binding).digest('hex');
        return `v1.${expiresAt}.${mac}`;
      },
    } : {}),
  };
  if (solSend) {
    const proposal = await runSolHandleSend(solSend, { botId, invoke: invokeRaw, spend });
    const reply = proposal.hold && !approvalContext.secret
      ? { reply: 'SOL confirmation is not available right now.' }
      : {
          reply: proposal.reply,
          ...(proposal.hold ? { hold: sealAssetSpendHold(proposal.hold, approvalContext) } : {}),
        };
    return Response.json(
      { ok: true, botId, provider: 'desk', toolRounds: 0, ...reply },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const chatModel = (typeof body.model === 'string' && /^[A-Za-z0-9_.:/-]{1,80}$/.test(body.model.trim()))
    ? body.model.trim()
    : (readRootEnv('OPENROUTER_MODEL_RESEARCH') || undefined);
  const chatKeys = {
    metaModelApiKey,
    openrouterApiKey,
    ...(body.modelProvider != null ? { modelProvider: body.modelProvider } : {}),
    botName: typeof body.name === 'string' ? body.name : 'Agent',
    botGoal: typeof body.goal === 'string' ? body.goal : '',
    botType: typeof body.type === 'string' ? body.type : 'trading',
    permission: permissionInstruction(permissionMode),
    permissionMode,
    grants,
    model: chatModel,
    reasoningEffort: typeof body.effort === 'string' ? body.effort : '',
  };
  const turnState = { fundProposed: false };
  const harnessCtx = {
    ownerId,
    botId,
    connectors,
    permissionMode,
    depth: 0,
    situation,
    invokeRaw: (name, args) => invokeRaw(name, stampSpendPermission(name, args, spend)),
    complete: (opts) => completeTextChat({
      ...chatKeys,
      botId,
      history: [],
      fetcher: fetch,
      turnState,
      ...opts,
    }),
  };

  const turnArgs = {
    botId,
    turnState,
    metaModelApiKey: chatKeys.metaModelApiKey,
    openrouterApiKey: chatKeys.openrouterApiKey,
    ...(chatKeys.modelProvider != null ? { modelProvider: chatKeys.modelProvider } : {}),
    botName: typeof body.name === 'string' ? body.name : 'Agent',
    botGoal: typeof body.goal === 'string' ? body.goal : '',
    botType: typeof body.type === 'string' ? body.type : 'trading',
    history: Array.isArray(body.history) ? body.history.slice(-400) : [],
    message: prepared?.message ?? message,
    model: chatModel,
    reasoningEffort: chatKeys.reasoningEffort,
    tools: agentToolSchemas(),
    toolsInstruction: [chatToolsInstruction(), prepared?.instruction].filter(Boolean).join('\n'),
    permission: chatKeys.permission,
    fileCatalog: Array.isArray(body.fileCatalog) ? body.fileCatalog.slice(0, 40) : [],
    permissionMode,
    reviewCap,
    grants,
    trackAgentTask: true,
    invokeTool: async (name, args) => {
      const hit = await dispatchHarness(name, args, harnessCtx);
      if (hit) return serializeToolResult(hit);
      return serializeToolResult(await invokeRaw(name, stampSpendPermission(name, args, spend)));
    },
  };

  async function runTurn(onMessage, onReplyEvent) {
    if (assetConfirmation) {
      let gate;
      const reply = await resumeAssetSpend(assetConfirmation, approvalContext, async (name, args) => {
        if (args.action === 'swap') return { clientSwap: {
          spend: { ...stampSpendPermission(name, args, spend), idempotencyKey: assetConfirmation.idempotencyKey },
          swapTicket: assetConfirmation.swapTicket,
        } };
        let approveOnce;
        if (assetConfirmation.budgetOverride != null) {
          const terms = parseSpendApprovalTerms(assetConfirmation.budgetOverride);
          if (!terms || !approvalContext.attestBudgetApproval) return { error: 'invalid_spend_approval' };
          approveOnce = await approvalContext.attestBudgetApproval(assetConfirmation, terms);
        }
        gate = await invokeRaw(name, { ...stampSpendPermission(name, args, spend),
          confirmed: true, idempotencyKey: assetConfirmation.idempotencyKey }, {
          approveOnce, spendAuthorization, swapTicket: assetConfirmation.swapTicket, lasoPayment, moveAuthorization,
        });
        return gate;
      });
      return (gate && approvalContext.attestBudgetApproval && budgetApprovalReply(assetConfirmation, gate, approvalContext)) || reply;
    }
    if (reviewSwap) {
      const hold = await loadPendingSwapHold();
      return { provider: 'desk', text: hold ? '' : 'This agent has no swap waiting for review.', hold };
    }
    return completeTextChat({ ...turnArgs, onMessage, onReplyEvent });
  }

  async function tryAutoSwap(hold, swapHold, swapPreview) {
    if (swapHold.args.amount !== hold.args.amount) return null;
    if (permissionMode === 'ask') return null;
    const approvalReason = permissionMode === 'review' && amountOverReviewCap(swapPreview.usdMicros, reviewCap)
      ? 'approval-needed' : null;
    if (approvalReason) {
      const message = swapFailure({ error: approvalReason }).message;
      swapHold.prompt = `${message} ${swapHold.prompt}`;
      swapHold.label = `${message} ${swapHold.label}`;
      return null;
    }
    const sent = await invokeRaw('request_spend', {
      ...hold.args, botId, permission: permissionMode, reviewCap: effectiveReviewCap(reviewCap),
      idempotencyKey: hold.idempotencyKey, autoSwap: true, confirmed: false,
    }, { swapTicket: swapHold.swapTicket });
    if (sent?.signed === true && typeof sent.signature === 'string') {
      return `${swapHold.label.replace(/ Budget charge.*$/, '')} Submitted automatically: https://solscan.io/tx/${sent.signature}`;
    }
    if (sent?.signed === false && sent.reason === 'swap_signer_missing'
        && sent.swapDelegation) {
      return { clientSwap: { spend: { ...hold.args, botId, permission: permissionMode,
        reviewCap: effectiveReviewCap(reviewCap), idempotencyKey: hold.idempotencyKey }, swapTicket: swapHold.swapTicket,
        delegation: { ...sent.swapDelegation, expiresAt: swapHold.expiresAt } } };
    }
    // Only a swap stopped before its reservation can still go to the slide under the same key.
    const beforeReserve = sent?.state === 'approval-needed' || sent?.state === 'trust-confirmation-required'
      || sent?.error === 'desk_locked';
    if (beforeReserve) {
      swapHold.prompt = `${swapFailure(sent).message} ${swapHold.prompt}`;
      swapHold.label = `${swapFailure(sent).message} ${swapHold.label}`;
    }
    return beforeReserve ? null : swapFailure(sent).message;
  }

  async function loadPendingSwapHold() {
    const status = await invokeRaw('get_bot_status', { botId });
    return pendingSwapHold(botId, status?.pendingSwap);
  }

  async function finishTurn(reply) {
    const startedTrade = ownerAsksForOneTrade(message) && reply.activity?.some(step => step.name === 'start_task');
    const trade = assetConfirmation || reviewSwap || reply.hold ? null : await ensureOwnerTradeLoop({
      message,
      goal: typeof body.goal === 'string' ? body.goal : '',
      permission: permissionMode,
      activity: reply.activity,
      invoke: invokeRaw,
    });
    const tradeLoop = trade?.loop && typeof trade.loop === 'object' ? trade.loop : null;
    if (!reply.hold && (tradeLoop || startedTrade)) {
      const pending = await loadPendingSwapHold();
      if (pending) reply = { ...reply, hold: pending, messages: [] };
      else if (tradeLoop?.run?.pauseReason === 'swap_requires_usd_budget') {
        reply = { ...reply, text: 'Live swaps need an agent with USD spending limits.', messages: [] };
      } else if (tradeLoop?.waiting || startedTrade) {
        reply = { ...reply, text: 'This run has no swap ready to approve.', messages: [] };
      }
    }
    const requestedSwap = reply.hold?.args?.action === 'swap';
    if (requestedSwap) {
      const preview = approvalContext.secret && await invokeRaw('request_spend', {
        ...reply.hold.args, botId, permission: 'ask', idempotencyKey: reply.hold.idempotencyKey,
      });
      const swapHold = swapHoldFromPreview(reply.hold, preview?.swapPreview);
      const auto = swapHold && await tryAutoSwap(reply.hold, swapHold, preview.swapPreview);
      reply = auto?.clientSwap
        ? { ...reply, text: '', hold: null, clientSwap: auto.clientSwap }
        : auto
        ? { ...reply, text: auto, hold: null }
        : swapHold
        ? { ...reply, text: swapHold.label, hold: swapHold,
          ...(swapHold.args.amount !== reply.hold.args.amount ? { messages: [] } : {}) }
        : { ...reply, text: preview?.error === 'swap_requires_usd_budget'
          ? swapFailure({ error: 'swap_requires_usd_budget' }).message
          : swapFailure(preview).message, hold: null };
    }
    const assetHold = isAssetSpendHold(reply.hold);
    const hold = assetHold
      ? sealAssetSpendHold(reply.hold, approvalContext)
      : reply.hold;
    const replies = Array.isArray(reply.messages)
      ? reply.messages.filter(item => typeof item === 'string' && item.trim())
      : [];
    return {
      ok: true,
      botId,
      reply: reply.text,
      ...(reply.agentTask ? { agentTask: reply.agentTask } : {}),
      ...(reply.proposedGoal ? { proposedGoal: reply.proposedGoal } : {}),
      ...(reply.clientSwap ? { clientSwap: reply.clientSwap } : {}),
      ...(moveAuthorization === 'prepare' && reply.moveAuthorization ? { moveAuthorization: reply.moveAuthorization } : {}),
      ...(assetConfirmation?.args?.action === 'x402' && reply.claimUrl ? { claimUrl: reply.claimUrl } : {}),
      ...(assetConfirmation?.args?.action === 'x402' && reply.lasoCard ? { lasoCard: reply.lasoCard } : {}),
      ...(lasoPayment?.phase === 'prepare' && reply.lasoPayment ? { lasoPayment: reply.lasoPayment } : {}),
      ...(assetConfirmation && spendAuthorization === 'prepare' && reply.spendAuthorization
        ? { spendAuthorization: reply.spendAuthorization } : {}),
      ...(replies.length > 0 ? { replies } : {}),
      ...(hold ? { hold } : {}),
      model: reply.model,
      provider: reply.provider,
      toolRounds: reply.toolRounds ?? 0,
      ...(readSubagentResults(ownerId, botId).length > 0
        ? { subagents: readSubagentResults(ownerId, botId) }
        : {}),
      ...(Array.isArray(reply.activity) && reply.activity.length > 0 ? { activity: reply.activity } : {}),
      ...(reply.usage ? { usage: reply.usage } : {}),
      ...(tradeLoop ? {
        trade: {
          ok: tradeLoop.ok === true && tradeLoop.error == null,
          done: tradeLoop.done === true,
          waiting: tradeLoop.waiting === true,
          pauseReason: tradeLoop.run?.pauseReason || tradeLoop.error || null,
          signed: tradeLoop.run?.checkpoints?.execute?.executed === true,
        },
      } : {}),
    };
  }

  const wantsStream = (request.headers.get('accept') || '').includes('text/event-stream');
  if (wantsStream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let provisional = false;
        const send = (payload) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        };
        const replyEvent = event => {
          provisional = event.type === 'reply_delta';
          send(event);
        };
        try {
          const reply = await runTurn(text => {
            provisional = false;
            send({ message: text });
          }, replyEvent);
          send({ done: true, ...(await finishTurn(reply)) });
        } catch (error) {
          const code = error instanceof TextChatError ? error.code : 'chat_failed';
          if (provisional) send({ type: 'reply_retract' });
          send({ error: code });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  }

  try {
    const reply = await runTurn();
    return Response.json(await finishTurn(reply), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const code = error instanceof TextChatError ? error.code : 'chat_failed';
    const status = error instanceof TextChatError ? error.status : 502;
    const payload = { error: code };
    if (error instanceof TextChatError && error.detail) payload.detail = error.detail;
    return Response.json(payload, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
