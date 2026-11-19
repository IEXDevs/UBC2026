/**
 * Owner situation for search and browser turns.
 * The clock is the server's. Place comes from the owner or the edge, never from the model.
 */

const PLACE = /^[\p{L}\p{N}][\p{L}\p{N} .,'’-]*$/u;
const NEAR = /\b(near me|nearby|around here|around town|in my area|in my city|close to me|where I am|local news|local events)\b/i;
const WHEN = /\b(today|tonight|tomorrow|this morning|this afternoon|this evening|this weekend|right now|open now)\b/i;
const WEATHER = /\b(weather|forecast)\b/i;
const NAMED_PLACE = /\b(?:in|at|near|around)\s+\p{Lu}/u;

function cleanPlace(value) {
  if (typeof value !== 'string') return '';
  const place = value.replace(/\s+/g, ' ').trim();
  if (!place || place.length > 80 || !PLACE.test(place)) return '';
  if (/https?:|[@/\\]/.test(place)) return '';
  return place;
}

function cleanZone(value) {
  if (typeof value !== 'string') return '';
  const zone = value.trim();
  if (!zone || zone.length > 64) return '';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date());
    return zone;
  } catch {
    return '';
  }
}

function cleanLocale(value) {
  if (typeof value !== 'string') return '';
  const locale = value.trim();
  if (!/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8}){0,2}$/.test(locale)) return '';
  try {
    new Intl.DateTimeFormat(locale).format(new Date());
    return locale;
  } catch {
    return '';
  }
}

function clockOf(situation) {
  const when = new Date(situation.at);
  const timeZone = situation.timeZone || 'UTC';
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(when);
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(when);
  return { date, label };
}

/**
 * Freeze a clock and an optional place. Invalid zones fall back to UTC.
 * A caller-supplied `at` is ignored so the model cannot set the clock.
 */
export function normalizeSituation(input, now = new Date()) {
  const clock = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const timeZone = cleanZone(source.timeZone || source.timezone) || 'UTC';
  const place = cleanPlace(source.place || source.location);
  const locale = cleanLocale(source.locale);
  return Object.freeze({
    at: clock.toISOString(),
    timeZone,
    place,
    locale,
  });
}

/**
 * Merge a client clock with edge geo. The client's place wins when they sent one.
 * Edge city and region fill place when the client did not.
 */
export function situationFromEdge(client, edge, now = new Date()) {
  const sent = client && typeof client === 'object' && !Array.isArray(client) ? client : {};
  const cf = edge && typeof edge === 'object' ? edge : {};
  const edgePlace = [cleanPlace(cf.city), cleanPlace(cf.region)].filter(Boolean).join(', ');
  return normalizeSituation({
    timeZone: sent.timeZone || sent.timezone || cf.timezone,
    place: cleanPlace(sent.place) || edgePlace,
    locale: sent.locale,
  }, now);
}

export function situationInstruction(input, now = new Date()) {
  const situation = input && typeof input.at === 'string' && typeof input.timeZone === 'string'
    ? input
    : normalizeSituation(input, now);
  const clock = clockOf(situation);
  const lines = [
    'Owner situation. Fold this into web_search queries and into search or map pages you open when the ask depends on where or when they are.',
    `Local time: ${clock.label} (${situation.timeZone}).`,
  ];
  if (situation.place) lines.push(`Place: ${situation.place}.`);
  else lines.push('Place is not set. Do not invent a city.');
  if (situation.locale) lines.push(`Language: ${situation.locale}.`);
  lines.push('For weather, hours, events, local news, "near me", "today", "tonight", or "this weekend", put the place and the local date in the query or the page.');
  lines.push('Leave the place off searches that are not about where or when they are.');
  return lines.join('\n');
}

function alreadyNamed(query, place) {
  if (place && query.toLowerCase().includes(place.toLowerCase())) return true;
  return NAMED_PLACE.test(query);
}

/** Add place and local date only when the query is local or time-bound. */
export function groundSearchQuery(query, situation) {
  const text = typeof query === 'string' ? query.trim() : '';
  if (!text || !situation || typeof situation.at !== 'string') return text;
  const place = typeof situation.place === 'string' ? situation.place : '';
  const named = alreadyNamed(text, place);
  let next = text;
  if (place && NEAR.test(next)) {
    next = next.replace(NEAR, `in ${place}`);
  } else if (place && WEATHER.test(next) && !named) {
    next = `${next} ${place}`;
  }
  if (WHEN.test(text)) {
    const { date } = clockOf(situation);
    if (date && !next.includes(date)) next = `${next} ${date}`;
  }
  return next.length > 1000 ? next.slice(0, 1000) : next;
}

const SEARCH_HOST = /(^|\.)(?:google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.brave\.com)$/i;

/** Rewrite a search or map query string. Other URLs stay as the model wrote them. */
export function groundBrowseUrl(url, situation) {
  if (typeof url !== 'string' || !url.trim() || !situation) return typeof url === 'string' ? url : '';
  let target;
  try {
    target = new URL(url.trim());
  } catch {
    return url;
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return url;
  if (!SEARCH_HOST.test(target.hostname)) return url;
  let changed = false;
  for (const key of ['q', 'query', 'search', 'text']) {
    const value = target.searchParams.get(key);
    if (!value) continue;
    const next = groundSearchQuery(value, situation);
    if (next && next !== value) {
      target.searchParams.set(key, next);
      changed = true;
    }
  }
  if (!changed) return url;
  return target.href.length > 2000 ? url : target.href;
}

/** Copy tool args with a grounded search query or browse URL. */
export function applySituation(name, args, situation) {
  const next = args && typeof args === 'object' && !Array.isArray(args) ? { ...args } : {};
  if (!situation) return args && typeof args === 'object' && !Array.isArray(args) ? args : next;
  if (name === 'web_search' && typeof next.query === 'string') {
    next.query = groundSearchQuery(next.query, situation);
  }
  if (
    (name === 'browser_open' || name === 'browser_navigate' || name === 'open_browser_session')
    && typeof next.url === 'string'
  ) {
    next.url = groundBrowseUrl(next.url, situation);
  }
  return next;
}
