import { readRootEnv } from '../../../../../lib/root-env.mjs';
import {
  chatToolsInstruction,
  createChatToolInvoker,
  openAiAgentTools,
  serializeToolResult,
} from '../../../../../lib/chat-tools.mjs';
import { fetchAgentRuntime } from '../../../../../lib/runtime-fetch.mjs';
import { completeTextChat, TextChatError } from '../../../../../lib/text-chat.mjs';
import { parsePermission, permissionInstruction, toolAccessKind } from '../../../../../lib/spend-permission.mjs';
import { MESSAGE_CHAR_CAP } from '../../../../../lib/context-usage.mjs';

const BOT_ID = /^[a-zA-Z0-9:_-]{1,128}$/;
const OWNER = /^[a-zA-Z0-9:_.-]{1,256}$/;

function chatToolEnv() {
  return {
    FIRECRAWL_API_KEY: readRootEnv('FIRECRAWL_API_KEY'),
    CLOUDFLARE_ACCOUNT_ID: readRootEnv('CLOUDFLARE_ACCOUNT_ID'),
    CLOUDFLARE_API_TOKEN: readRootEnv('CLOUDFLARE_API_TOKEN'),
    // Text-chat get_wallets enriches shell wallet addresses via QuickNode when
    // Supabase rows are missing — same secret the Worker uses.
    QUICKNODE_DEVNET_RPC_URL: readRootEnv('QUICKNODE_DEVNET_RPC_URL')
      || (typeof process.env.QUICKNODE_DEVNET_RPC_URL === 'string'
        ? process.env.QUICKNODE_DEVNET_RPC_URL.trim()
        : ''),
    QUICKNODE_TESTNET_RPC_URL: readRootEnv('QUICKNODE_TESTNET_RPC_URL')
      || (typeof process.env.QUICKNODE_TESTNET_RPC_URL === 'string'
        ? process.env.QUICKNODE_TESTNET_RPC_URL.trim()
        : ''),
    JUPITER_API_KEY: readRootEnv('JUPITER_API_KEY'),
    NEXT_PUBLIC_AGENT_RUNTIME_URL: readRootEnv('NEXT_PUBLIC_AGENT_RUNTIME_URL')
      || (typeof process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL === 'string'
        ? process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL.trim()
        : ''),
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
  const grants = Array.isArray(body.grants)
    ? body.grants.slice(0, 4).filter(item => item && typeof item.name === 'string')
    : [];
  const authHeader = request.headers.get('authorization') ?? '';
  const accessToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : (typeof body.accessToken === 'string' ? body.accessToken.trim() : '');
  const env = chatToolEnv();
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
    fetcher: async (url, init) => {
      try {
        return await fetchAgentRuntime(url, init);
      } catch {
        return fetch(url, init);
      }
    },
    // Price hosts must not ride the runtime service binding. A 404 from the
    // Worker is not a DexScreener outage.
    priceFetch: fetch,
  });

  try {
    const reply = await completeTextChat({
      metaModelApiKey: readRootEnv('META_MODEL_API_KEY'),
      openrouterApiKey: readRootEnv('OPENROUTER_API_KEY'),
      botName: typeof body.name === 'string' ? body.name : 'Agent',
      botGoal: typeof body.goal === 'string' ? body.goal : '',
      botType: typeof body.type === 'string' ? body.type : 'trading',
      history: Array.isArray(body.history) ? body.history.slice(-400) : [],
      message,
      model: (typeof body.model === 'string' && /^[A-Za-z0-9_.:/-]{1,80}$/.test(body.model.trim()))
        ? body.model.trim()
        : (readRootEnv('OPENROUTER_MODEL_RESEARCH') || undefined),
      reasoningEffort: typeof body.effort === 'string' ? body.effort : '',
      tools: openAiAgentTools(),
      toolsInstruction: chatToolsInstruction(),
      permission: permissionInstruction(permissionMode),
      fileCatalog: Array.isArray(body.fileCatalog) ? body.fileCatalog.slice(0, 40) : [],
      permissionMode,
      grants,
      invokeTool: async (name, args) => {
        const next = args && typeof args === 'object' ? { ...args } : {};
        if (name === 'start_task') {
          if (permissionMode === 'full') next.ownerPermission = 'full';
          else delete next.ownerPermission;
        }
        if (name === 'request_spend' || name === 'sns_send' || name === 'prepare_shopping') {
          next.permission = permissionMode;
          if (permissionMode !== 'full' && toolAccessKind(permissionMode, name)) next.confirmed = true;
        }
        return serializeToolResult(await invokeRaw(name, next));
      },
    });
    return Response.json(
      {
        ok: true,
        botId,
        reply: reply.text,
        ...(reply.hold ? { hold: reply.hold } : {}),
        model: reply.model,
        provider: reply.provider,
        toolRounds: reply.toolRounds ?? 0,
        ...(Array.isArray(reply.activity) && reply.activity.length > 0 ? { activity: reply.activity } : {}),
        ...(reply.usage ? { usage: reply.usage } : {}),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const code = error instanceof TextChatError ? error.code : 'chat_failed';
    const status = error instanceof TextChatError ? error.status : 502;
    const payload = { error: code };
    if (error instanceof TextChatError && error.detail) payload.detail = error.detail;
    return Response.json(payload, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
