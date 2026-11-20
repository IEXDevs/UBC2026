import { accessTokenFromRequest } from '../../../../../lib/privy-cookie-session.mjs';
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
import { parsePermission, permissionInstruction } from '../../../../../lib/spend-permission.mjs';
import {
  agentToolSchemas,
  dispatchHarness,
  linkedConnectorIds,
  ownerReviewCap,
  prepareOwnerTurn,
  stampSpendPermission,
} from '../../../../../lib/harness-run.mjs';
import { situationFromEdge } from '@ubc2026/agent-tools';
import { visitorGeo } from '../../../../../lib/visitor-geo.mjs';
import { readSubagentResults } from '../../../../../lib/subagent-board.mjs';
import { MESSAGE_CHAR_CAP } from '../../../../../lib/context-usage.mjs';
import { ensureOwnerTradeLoop } from '../../../../../lib/owner-trade.mjs';
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

function budgetApprovalReply(hold, gate) {
  const terms = parseSpendApprovalTerms(gate?.approvalTerms);
  const { action, asset, handle, destination, amount } = hold.args;
  if (hold.budgetOverride || action !== 'spend' || asset !== 'SOL'
    || !handle || !destination || !terms || gate.signed !== false
    || (gate.error || gate.state) !== 'approval-needed' || gate.reason !== 'per-transaction') return null;
  const label = `Approve once: send ${formatBaseUnits(amount, 9)} SOL to @${handle} (${shortAddress(destination)}) plus a ${formatBaseUnits(terms.feeLamports, 9)} SOL fee.`;
  const prompt = `${label} This overrides the agent’s per-transfer limit and, if needed, its remaining budget for this payment only. The limits won’t change. Slide to approve once.`;
  return { provider: 'desk', toolRounds: 1, text: prompt, hold: { ...hold, budgetOverride: terms, label, prompt } };
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
  const spendAuthorization = body.spendAuthorization === 'prepare'
    ? 'prepare' : parseSpendAuthorizationSignature(body.spendAuthorization);
  if (body.spendAuthorization !== undefined && (!assetConfirmation || !spendAuthorization)) {
    return Response.json({ error: 'invalid_spend_authorization' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const solSend = assetConfirmation ? null : parseSolHandleSend(message);
  const noModel = solSend || assetConfirmation;
  const connectors = noModel ? [] : linkedConnectorIds(body.connectors);
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
  const spend = { permissionMode, reviewCap, confirmSpend: true, grants };
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
      history: [],
      fetcher: fetch,
      ...opts,
    }),
  };

  const turnArgs = {
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
    invokeTool: async (name, args) => {
      const hit = await dispatchHarness(name, args, harnessCtx);
      if (hit) return serializeToolResult(hit);
      return serializeToolResult(await invokeRaw(name, stampSpendPermission(name, args, spend)));
    },
  };

  async function runTurn(onMessage) {
    if (assetConfirmation) {
      let gate;
      const reply = await resumeAssetSpend(assetConfirmation, approvalContext, async (name, args) => {
        let approveOnce;
        if (assetConfirmation.budgetOverride != null) {
          const terms = parseSpendApprovalTerms(assetConfirmation.budgetOverride);
          if (!terms || !approvalContext.attestBudgetApproval) return { error: 'invalid_spend_approval' };
          approveOnce = await approvalContext.attestBudgetApproval(assetConfirmation, terms);
        }
        gate = await invokeRaw(name, stampSpendPermission(name, args, spend), {
          approveOnce, spendAuthorization, swapTicket: assetConfirmation.swapTicket,
        });
        return gate;
      });
      return (gate && approvalContext.attestBudgetApproval && budgetApprovalReply(assetConfirmation, gate)) || reply;
    }
    return completeTextChat({ ...turnArgs, onMessage });
  }

  async function finishTurn(reply) {
    const requestedSwap = reply.hold?.args?.action === 'swap';
    if (requestedSwap) {
      const preview = approvalContext.secret && await invokeRaw('request_spend', {
        ...reply.hold.args, botId, permission: 'ask', idempotencyKey: reply.hold.idempotencyKey,
      });
      const swapHold = swapHoldFromPreview(reply.hold, preview?.swapPreview);
      reply = swapHold
        ? { ...reply, text: swapHold.label, hold: swapHold }
        : { ...reply, text: preview?.error === 'swap_requires_usd_budget'
          ? 'Live swaps need an agent with USD spending limits.'
          : 'I could not prepare a live swap quote. No funds moved.', hold: null };
    }
    const assetHold = isAssetSpendHold(reply.hold);
    const hold = assetHold
      ? sealAssetSpendHold(reply.hold, approvalContext)
      : reply.hold;
    const trade = assetConfirmation || assetHold || requestedSwap ? null : await ensureOwnerTradeLoop({
      message,
      goal: typeof body.goal === 'string' ? body.goal : '',
      permission: permissionMode,
      activity: reply.activity,
      invoke: invokeRaw,
    });
    const tradeLoop = trade?.loop && typeof trade.loop === 'object' ? trade.loop : null;
    const replies = Array.isArray(reply.messages)
      ? reply.messages.filter(item => typeof item === 'string' && item.trim())
      : [];
    return {
      ok: true,
      botId,
      reply: reply.text,
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
        const send = (payload) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        };
        try {
          const reply = await runTurn(text => send({ message: text }));
          send({ done: true, ...(await finishTurn(reply)) });
        } catch (error) {
          const code = error instanceof TextChatError ? error.code : 'chat_failed';
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
