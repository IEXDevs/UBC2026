/**
 * Wire browser-session agentTools into same-origin text chat.
 * Browser open/live-view/release prefer the Worker (same DO store as Live View).
 * Search/scrape use Firecrawl from root env when present.
 */

import {
  agentTools,
  createBrowserSessionService,
  createMemoryStore,
  ProviderError,
  SessionError,
} from '@ubc2026/browser-session';
import { createBrowserProvider, createScrape, createSearch } from '@ubc2026/browser-search';
import { browserSessionUrl } from './live-view.mjs';
import { runtimeBaseUrl } from './runtime-data.mjs';

const MAX_TOOL_RESULT = 6000;

export function openAiAgentTools(tools = agentTools) {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export function chatToolsInstruction() {
  return [
    'You have tools: web_search, web_scrape, browser_open, browser_live_view, and browser_release.',
    'When the owner asks you to look something up, browse, or open a page, call those tools.',
    'Do not claim you lack a browser or web access while these tools are available.',
    'If a tool returns not_configured or an error code, tell the owner which secret or Worker setting is missing.',
    'After browser_open or browser_live_view, tell the owner to use Show live view on the Live View panel — not Open browser session again (that hits concurrency_limit).',
    'browser_live_view never returns a viewer URL to you — the owner Live View panel shows it.',
  ].join('\n');
}

function clipJson(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text.length <= MAX_TOOL_RESULT) return text;
  return `${text.slice(0, MAX_TOOL_RESULT)}…[truncated]`;
}

function toolErrorPayload(error) {
  const code = typeof error?.code === 'string' && error.code
    ? error.code
    : (error instanceof ProviderError || error instanceof SessionError ? error.code : 'tool_failed');
  return { error: code };
}

async function workerJson(fetcher, url, ownerId, method, body) {
  const response = await fetcher(url, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-owner-id': ownerId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = typeof data.error === 'string' ? data.error : 'browser_request_failed';
    const err = new Error(code);
    err.code = code;
    throw err;
  }
  return data;
}

function localBrowserService(env = {}, fetcher = fetch) {
  return createBrowserSessionService({
    store: createMemoryStore(),
    search: createSearch({ apiKey: env.FIRECRAWL_API_KEY, fetcher }),
    scrape: createScrape({ apiKey: env.FIRECRAWL_API_KEY, fetcher }),
    browsers: createBrowserProvider({
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      apiToken: env.CLOUDFLARE_API_TOKEN,
      fetcher,
    }),
  });
}

/**
 * Build an invokeTool(name, args) for completeTextChat.
 * Prefer Worker browser routes when NEXT_PUBLIC_AGENT_RUNTIME_URL is set.
 */
export function createChatToolInvoker({
  ownerId,
  botId,
  env = {},
  fetcher = fetch,
  runtimeBase = runtimeBaseUrl(env.NEXT_PUBLIC_AGENT_RUNTIME_URL),
} = {}) {
  if (typeof ownerId !== 'string' || !ownerId || typeof botId !== 'string' || !botId) {
    throw new Error('invalid_identity');
  }
  const identity = { ownerId, botId };
  const local = localBrowserService(env, fetcher);
  const root = runtimeBaseUrl(runtimeBase);

  async function invokeBrowser(name, args = {}) {
    const openUrl = browserSessionUrl(root, botId);
    if (!openUrl) {
      return local.invokeTool(name, args, identity);
    }
    if (name === 'browser_open') {
      const opened = await workerJson(fetcher, openUrl, ownerId, 'POST', {
        purpose: typeof args.purpose === 'string' ? args.purpose : 'browse',
      });
      return {
        sessionRecordId: opened.sessionRecordId,
        purpose: opened.purpose,
        status: opened.status || 'open',
      };
    }
    if (name === 'browser_live_view') {
      const sessionRecordId = typeof args.sessionRecordId === 'string' ? args.sessionRecordId : '';
      const url = browserSessionUrl(root, botId, { sessionRecordId, action: 'live-view' });
      const view = await workerJson(fetcher, url, ownerId, 'POST', {});
      // Never return viewerUrl to the model.
      return {
        sessionRecordId: view.sessionRecordId || sessionRecordId,
        mode: view.mode,
        connectBefore: view.connectBefore,
        embedVerified: view.embedVerified,
        fallback: view.fallback,
        note: 'Live View is ready for the owner UI. The viewer URL is not returned to chat.',
      };
    }
    if (name === 'browser_release') {
      const sessionRecordId = typeof args.sessionRecordId === 'string' ? args.sessionRecordId : '';
      const url = browserSessionUrl(root, botId, { sessionRecordId, action: 'release' });
      const released = await workerJson(fetcher, url, ownerId, 'POST', {});
      return {
        sessionRecordId: released.sessionRecordId || sessionRecordId,
        status: released.status || 'closed',
      };
    }
    return local.invokeTool(name, args, identity);
  }

  return async function invokeTool(name, args = {}) {
    try {
      if (name === 'web_search' || name === 'web_scrape') {
        return await local.invokeTool(name, args, identity);
      }
      if (name === 'browser_open' || name === 'browser_live_view' || name === 'browser_release') {
        return await invokeBrowser(name, args);
      }
      return await local.invokeTool(name, args, identity);
    } catch (error) {
      return toolErrorPayload(error);
    }
  };
}

export function serializeToolResult(result) {
  if (result && typeof result === 'object' && result.viewerUrl) {
    const { viewerUrl: _viewerUrl, ...rest } = result;
    return clipJson(rest);
  }
  return clipJson(result);
}
