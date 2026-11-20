/**
 * ElevenAgents client tools for the glass app (Isaac / 8B).
 * These run in the browser and only navigate/confirm — spend still goes through
 * the same trust → verify → policy → approval path as the UI.
 */

export const VOICE_CLIENT_TOOLS = Object.freeze([
  'open_bot',
  'show_live_view',
  'confirm_dialog',
  'read_back',
  // Shell-side mirrors so voice can see local roster/wallets even before Supabase sync.
  'list_shell_bots',
  'list_shell_wallets',
]);

export function voiceToolDefinitions() {
  return [
    {
      name: 'open_bot',
      description: 'Open a bot in the Agents pane by id or name.',
      parameters: {
        type: 'object',
        properties: {
          botId: { type: 'string', description: 'Bot id when known' },
          name: { type: 'string', description: 'Bot display name fallback' },
        },
      },
    },
    {
      name: 'show_live_view',
      description: 'Focus the Live View for the active bot.',
      parameters: {
        type: 'object',
        properties: {
          botId: { type: 'string' },
        },
      },
    },
    {
      name: 'confirm_dialog',
      description: 'Ask the owner to confirm a spoken action before it runs.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          actionId: { type: 'string' },
        },
        required: ['prompt'],
      },
    },
    {
      name: 'read_back',
      description: 'Return a short spoken summary of the current pane or approval.',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'overview | approval | timeline | security' },
        },
      },
    },
    {
      name: 'list_shell_bots',
      description: 'List bots visible in the owner shell (local roster + live runtime).',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'list_shell_wallets',
      description: 'List wallets visible in the owner shell.',
      parameters: { type: 'object', properties: {} },
    },
  ];
}

function findBot(bots, { botId, name } = {}) {
  const list = Array.isArray(bots) ? bots : [];
  if (botId) {
    const byId = list.find((b) => b.id === botId);
    if (byId) return byId;
  }
  if (name) {
    const needle = String(name).trim().toLowerCase();
    return list.find((b) => String(b.name).toLowerCase() === needle)
      || list.find((b) => String(b.name).toLowerCase().includes(needle))
      || null;
  }
  return null;
}

/**
 * Create client-tool handlers bound to shell setters.
 * `confirm` should return a boolean. The shell passes a slide, not a browser dialog.
 */
export function createVoiceClientTools({
  bots = [],
  wallets = [],
  activeBotId = null,
  pane = 'Agents',
  approvalSummary = null,
  setActiveBotId,
  setPane,
  focusLiveView,
  confirm = async () => false,
  pushEvent = null,
  conversation = null,
  locked = false,
} = {}) {
  if (locked === true) {
    const blocked = {};
    for (const name of VOICE_CLIENT_TOOLS) {
      blocked[name] = async () => ({ ok: false, error: 'desk_locked' });
    }
    return blocked;
  }
  return {
    async list_shell_bots() {
      const items = (Array.isArray(bots) ? bots : []).map((bot) => ({
        id: bot.id,
        name: bot.name,
        type: bot.type,
        status: bot.status,
        goal: bot.goal,
        walletId: bot.walletId || null,
      }));
      if (typeof pushEvent === 'function') pushEvent({ kind: 'client.list_shell_bots', count: items.length });
      return { ok: true, source: 'shell', items, count: items.length };
    },
    async list_shell_wallets() {
      const items = (Array.isArray(wallets) ? wallets : []).map((wallet) => ({
        id: wallet.id,
        label: wallet.label,
        kind: wallet.kind,
        address: wallet.address,
        frozen: wallet.frozen === true,
      }));
      if (typeof pushEvent === 'function') pushEvent({ kind: 'client.list_shell_wallets', count: items.length });
      return { ok: true, source: 'shell', items, count: items.length };
    },
    async open_bot(params = {}) {
      const bot = findBot(bots, params);
      if (!bot) return { ok: false, error: 'bot_not_found' };
      if (typeof setActiveBotId === 'function') setActiveBotId(bot.id);
      if (typeof setPane === 'function') setPane('Main');
      if (typeof pushEvent === 'function') pushEvent({ kind: 'client.open_bot', botId: bot.id });
      return { ok: true, botId: bot.id, name: bot.name, pane: 'Main' };
    },
    async show_live_view(params = {}) {
      const bot = findBot(bots, { botId: params.botId || activeBotId });
      if (!bot) return { ok: false, error: 'bot_not_found' };
      if (typeof setActiveBotId === 'function') setActiveBotId(bot.id);
      if (typeof setPane === 'function') setPane('Main');
      if (typeof focusLiveView === 'function') focusLiveView(bot.id);
      if (typeof pushEvent === 'function') pushEvent({ kind: 'client.show_live_view', botId: bot.id });
      return { ok: true, botId: bot.id, focused: 'live-view' };
    },
    async confirm_dialog(params = {}) {
      const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : '';
      if (!prompt) return { ok: false, error: 'prompt_required' };
      const accepted = Boolean(await confirm(prompt));
      if (typeof pushEvent === 'function') {
        pushEvent({ kind: 'client.confirm', actionId: params.actionId || null, accepted });
      }
      return { ok: true, accepted, actionId: params.actionId || null };
    },
    async read_back(params = {}) {
      const topic = params.topic || pane?.toLowerCase() || 'overview';
      let text;
      if (topic === 'approval' && approvalSummary) {
        text = approvalSummary;
      } else if (topic === 'security') {
        text = 'Security pane: pause every agent, freeze, or request grab-back. Keys stay in Privy.';
      } else if (topic === 'timeline') {
        text = 'Timeline shows recent tool and trust events for the active agent.';
      } else if (topic === 'conversation' && conversation?.recentText) {
        text = conversation.recentText() || 'Conversation is empty.';
      } else if (topic === 'overview') {
        text = `Overview across ${bots.length} agents. Open an agent for approvals and Live View.`;
      } else {
        const bot = findBot(bots, { botId: activeBotId }) || bots[0];
        text = bot
          ? `${bot.name} is ${bot.status}. Goal: ${bot.goal}`
          : 'No agents yet. Create one from the sidebar.';
      }
      if (conversation?.recentText && topic !== 'conversation') {
        const recent = conversation.recentText(3);
        if (recent) text = `${text} Recent: ${recent.replace(/\n/g, ' / ')}`;
      }
      if (typeof pushEvent === 'function') pushEvent({ kind: 'client.read_back', topic, text });
      return { ok: true, text };
    },
  };
}

/** Dispatch a single client tool call by name. */
export async function runVoiceClientTool(tools, name, params) {
  if (!tools || typeof tools[name] !== 'function') {
    return { ok: false, error: 'unknown_tool' };
  }
  return tools[name](params || {});
}
