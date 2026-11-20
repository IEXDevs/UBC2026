const INLINE = /\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^\s)]+)\)|https?:\/\/[^\s<>)\]]+|\n/g;

function httpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function replyMarkdownParts(text) {
  const source = typeof text === 'string' ? text.replace(/\r\n?/g, '\n') : '';
  const parts = [];
  let last = 0;
  for (const match of source.matchAll(INLINE)) {
    if (match.index > last) parts.push({ type: 'text', value: source.slice(last, match.index) });
    if (match[1]) parts.push({ type: 'strong', children: replyMarkdownParts(match[1]) });
    else if (match[2]) {
      parts.push(httpUrl(match[3])
        ? { type: 'link', value: match[2], href: match[3] }
        : { type: 'text', value: match[2] });
    } else if (match[0] === '\n') parts.push({ type: 'break' });
    else {
      const href = match[0].replace(/[.,!?;:]+$/, '');
      const suffix = match[0].slice(href.length);
      parts.push(httpUrl(href) ? { type: 'link', value: href, href } : { type: 'text', value: match[0] });
      if (httpUrl(href) && suffix) parts.push({ type: 'text', value: suffix });
    }
    last = match.index + match[0].length;
  }
  if (last < source.length) parts.push({ type: 'text', value: source.slice(last) });
  return parts;
}

export function replyLinks(text) {
  const collect = parts => parts.flatMap(part => part.type === 'link' ? [part.href] : part.children ? collect(part.children) : []);
  return [...new Set(collect(replyMarkdownParts(text)))];
}

export function replySpeechText(text) {
  const plain = parts => parts.map(part => part.type === 'break' ? ' '
    : part.children ? plain(part.children)
      : part.type === 'link' && part.value === part.href ? '' : part.value).join('');
  return plain(replyMarkdownParts(text)).replace(/\*\*/g, '').replace(/\]\(\s*\)/g, '').replace(/\]\(/g, ' ').replace(/[\[\]]/g, '')
    .replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
}
