import { readRootEnv } from '../../../../../lib/root-env.mjs';
import { completeTextChat, TextChatError } from '../../../../../lib/text-chat.mjs';

const BOT_ID = /^[a-zA-Z0-9:_-]{1,128}$/;
const OWNER = /^[a-zA-Z0-9:_.-]{1,256}$/;

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

  try {
    const reply = await completeTextChat({
      modelApiKey: readRootEnv('MODEL_API_KEY'),
      openrouterApiKey: readRootEnv('OPENROUTER_API_KEY'),
      botName: typeof body.name === 'string' ? body.name : 'Agent',
      botGoal: typeof body.goal === 'string' ? body.goal : '',
      botType: typeof body.type === 'string' ? body.type : 'trading',
      history: Array.isArray(body.history) ? body.history : [],
      message,
      model: readRootEnv('OPENROUTER_MODEL_RESEARCH') || undefined,
    });
    return Response.json(
      { ok: true, botId, reply: reply.text, model: reply.model, provider: reply.provider },
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
