import { readRootEnv } from '../../../../../lib/root-env.mjs';
import {
  chatToolsInstruction,
  createChatToolInvoker,
  openAiAgentTools,
  serializeToolResult,
} from '../../../../../lib/chat-tools.mjs';
import { completeTextChat, TextChatError } from '../../../../../lib/text-chat.mjs';

const BOT_ID = /^[a-zA-Z0-9:_-]{1,128}$/;
const OWNER = /^[a-zA-Z0-9:_.-]{1,256}$/;

function chatToolEnv() {
  return {
    FIRECRAWL_API_KEY: readRootEnv('FIRECRAWL_API_KEY'),
    CLOUDFLARE_ACCOUNT_ID: readRootEnv('CLOUDFLARE_ACCOUNT_ID'),
    CLOUDFLARE_API_TOKEN: readRootEnv('CLOUDFLARE_API_TOKEN'),
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
  if (!message || message.length > 4000) {
    return Response.json({ error: 'message_required' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  const env = chatToolEnv();
  const invokeRaw = createChatToolInvoker({
    ownerId,
    botId,
    env,
    runtimeBase: env.NEXT_PUBLIC_AGENT_RUNTIME_URL,
  });

  try {
    const reply = await completeTextChat({
      metaModelApiKey: readRootEnv('META_MODEL_API_KEY'),
      openrouterApiKey: readRootEnv('OPENROUTER_API_KEY'),
      botName: typeof body.name === 'string' ? body.name : 'Agent',
      botGoal: typeof body.goal === 'string' ? body.goal : '',
      botType: typeof body.type === 'string' ? body.type : 'trading',
      history: Array.isArray(body.history) ? body.history : [],
      message,
      model: readRootEnv('OPENROUTER_MODEL_RESEARCH') || undefined,
      tools: openAiAgentTools(),
      toolsInstruction: chatToolsInstruction(),
      invokeTool: async (name, args) => serializeToolResult(await invokeRaw(name, args)),
    });
    return Response.json(
      {
        ok: true,
        botId,
        reply: reply.text,
        model: reply.model,
        provider: reply.provider,
        toolRounds: reply.toolRounds ?? 0,
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
