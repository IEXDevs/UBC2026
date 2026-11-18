/**
 * Public chat trace for a tool round. Titles, hosts, and queries only.
 * Live View URLs and raw tool payloads stay out.
 */

const LABELS = Object.freeze({
  web_search: 'Searched the web',
  web_scrape: 'Read a page',
  browser_open: 'Opened a browser',
  browser_navigate: 'Opened a page',
  browser_live_view: 'Checked the live view',
  browser_release: 'Released the browser',
  get_price: 'Checked a price',
  create_loop: 'Started a loop',
  set_loop_cooldown: 'Set the loop cooldown',
  break_loop: 'Broke the loop',
});

const PAGE_TOOLS = new Set(['web_scrape', 'browser_navigate', 'browser_open']);
const SECRET_KEY = /key|token|secret|password|authorization|cookie|seed|phrase/i;
const SECRET_VALUE = /eyJ[A-Za-z0-9_-]{8,}|live\.browser\.run/i;

function clip(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function parseResult(result) {
  if (typeof result === 'string') {
    try {
      const parsed = JSON.parse(result);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  return result && typeof result === 'object' ? result : null;
}

function publicUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = url.hostname.replace(/^www\./, '').slice(0, 120);
    if (!host || host === 'live.browser.run') return null;
    return { url: url.href.slice(0, 500), host };
  } catch {
    return null;
  }
}

function siteFrom(entry) {
  const page = publicUrl(entry?.url);
  if (!page) return null;
  return { title: clip(entry?.title, 140), url: page.url, host: page.host };
}

function sitesFrom(parsed) {
  const rows = Array.isArray(parsed?.results) ? parsed.results : [];
  const sites = [];
  for (const entry of rows) {
    const site = siteFrom(entry);
    if (!site) continue;
    if (sites.some(item => item.url === site.url)) continue;
    sites.push(site);
    if (sites.length >= 6) break;
  }
  return sites;
}

export function thinkStep(text) {
  const clean = clip(text, 800);
  if (!clean) return null;
  return { kind: 'think', text: clean };
}

function commandLine(name, args) {
  const parts = [name];
  if (!args || typeof args !== 'object' || Array.isArray(args)) return name;
  for (const key of Object.keys(args).slice(0, 6)) {
    if (SECRET_KEY.test(key)) continue;
    const value = args[key];
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
    const text = String(value).trim();
    if (!text || SECRET_VALUE.test(text)) continue;
    parts.push(`${key}=${text.slice(0, 120)}`);
  }
  return parts.join(' ').slice(0, 240);
}

function failureText(parsed) {
  const error = clip(parsed?.error, 80).replace(SECRET_VALUE, '[hidden]');
  const hint = clip(parsed?.hint, 180).replace(SECRET_VALUE, '[hidden]');
  const extra = clip(typeof parsed?.detail === 'string' ? parsed.detail : '', 180).replace(SECRET_VALUE, '[hidden]');
  return [error, hint && hint !== error ? hint : '', extra && extra !== error && extra !== hint ? extra : '']
    .filter(Boolean)
    .join('\n')
    .slice(0, 400);
}

function withFailure(step, name, args, parsed, failed) {
  if (!failed) return step;
  return {
    ...step,
    status: 'error',
    command: commandLine(name, args),
    error: failureText(parsed),
  };
}

export function toolStep(name, args, result) {
  const tool = clip(name, 64);
  if (!tool) return null;
  const parsed = parseResult(result);
  const failed = (typeof parsed?.error === 'string' && parsed.error.length > 0) || parsed?.ok === false;
  const status = failed ? 'error' : 'done';
  if (parsed?.error === 'repeated_tool') return null;
  if (parsed?.error === 'site_blocked') {
    return withFailure({
      kind: 'tool',
      name: tool,
      label: 'Skipped a blocked site',
      detail: clip(parsed.host, 80),
      status: 'error',
    }, tool, args, parsed, true);
  }
  if (tool === 'web_search') {
    const query = clip(args?.query, 160);
    return withFailure({
      kind: 'search',
      query: /^(search|web search|browse|browser)$/i.test(query) ? '' : query,
      sites: failed ? [] : sitesFrom(parsed),
      status,
    }, tool, args, parsed, failed);
  }
  if (PAGE_TOOLS.has(tool)) {
    const page = siteFrom({
      url: parsed?.page?.url || parsed?.url || args?.url,
      title: parsed?.page?.title || parsed?.title,
    });
    if (page && !failed) {
      return { kind: 'page', label: LABELS[tool], title: page.title, url: page.url, host: page.host, status };
    }
  }
  const detail = tool === 'get_price' ? clip(args?.mint, 48) : '';
  return withFailure({
    kind: 'tool',
    name: tool,
    label: failed ? `${LABELS[tool] || tool.replaceAll('_', ' ')} failed` : (LABELS[tool] || tool.replaceAll('_', ' ')),
    detail,
    status,
  }, tool, args, parsed, failed);
}

function failureFields(step) {
  const command = clip(step.command, 240).replace(SECRET_VALUE, '[hidden]');
  const error = clip(step.error, 400).replace(SECRET_VALUE, '[hidden]');
  return {
    ...(command ? { command } : {}),
    ...(error ? { error } : {}),
  };
}

function cleanSite(site) {
  const page = publicUrl(site?.url);
  if (!page || page.host !== clip(site?.host, 120)) return null;
  return { title: clip(site?.title, 140), url: page.url, host: page.host };
}

/** Drop anything a stored transcript should not render. */
export function sanitizeActivity(value) {
  if (!Array.isArray(value)) return [];
  const steps = [];
  for (const step of value) {
    if (!step || typeof step !== 'object') continue;
    if (step.kind === 'think') {
      const text = clip(step.text, 800);
      if (text) steps.push({ kind: 'think', text });
    } else if (step.kind === 'search') {
      const sites = (Array.isArray(step.sites) ? step.sites : []).map(cleanSite).filter(Boolean).slice(0, 6);
      const searchStatus = step.status === 'error' ? 'error' : 'done';
      steps.push({
        kind: 'search',
        query: clip(step.query, 160),
        sites,
        status: searchStatus,
        ...(searchStatus === 'error' ? failureFields(step) : {}),
      });
    } else if (step.kind === 'page') {
      const site = cleanSite(step);
      if (!site) continue;
      steps.push({
        kind: 'page',
        label: clip(step.label, 80) || 'Opened a page',
        title: site.title,
        url: site.url,
        host: site.host,
        status: step.status === 'error' ? 'error' : 'done',
      });
    } else if (step.kind === 'tool') {
      const label = clip(step.label, 80);
      if (!label) continue;
      const toolStatus = step.status === 'error' ? 'error' : 'done';
      steps.push({
        kind: 'tool',
        name: clip(step.name, 64),
        label,
        detail: clip(step.detail, 80),
        status: toolStatus,
        ...(toolStatus === 'error' ? failureFields(step) : {}),
      });
    }
    if (steps.length >= 12) break;
  }
  const unique = [];
  for (const step of steps) {
    const prev = unique.at(-1);
    if (prev && JSON.stringify(prev) === JSON.stringify(step)) continue;
    unique.push(step);
  }
  return unique;
}
