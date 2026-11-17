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
});

const PAGE_TOOLS = new Set(['web_scrape', 'browser_navigate', 'browser_open']);

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

export function toolStep(name, args, result) {
  const tool = clip(name, 64);
  if (!tool) return null;
  const parsed = parseResult(result);
  const failed = typeof parsed?.error === 'string' && parsed.error.length > 0;
  const status = failed ? 'error' : 'done';
  if (parsed?.error === 'repeated_tool') return null;
  if (parsed?.error === 'site_blocked') {
    return {
      kind: 'tool',
      name: tool,
      label: 'Skipped a blocked site',
      detail: clip(parsed.host, 80),
      status: 'error',
    };
  }
  if (tool === 'web_search') {
    const query = clip(args?.query, 160);
    return {
      kind: 'search',
      query: /^(search|web search|browse|browser)$/i.test(query) ? '' : query,
      sites: failed ? [] : sitesFrom(parsed),
      status,
    };
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
  return {
    kind: 'tool',
    name: tool,
    label: LABELS[tool] || tool.replaceAll('_', ' '),
    detail,
    status,
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
      steps.push({
        kind: 'search',
        query: clip(step.query, 160),
        sites,
        status: step.status === 'error' ? 'error' : 'done',
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
      steps.push({
        kind: 'tool',
        name: clip(step.name, 64),
        label,
        detail: clip(step.detail, 80),
        status: step.status === 'error' ? 'error' : 'done',
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
