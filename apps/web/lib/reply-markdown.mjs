const INLINE = /\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^\s)]+)\)|https?:\/\/[^\s<>)\]]+|\n/g;
const HEADING = /^\s{0,3}#{1,6}\s+(.+)$/;
const BULLET = /^\s{0,3}[-*+]\s+(.+)$/;
const ORDERED = /^\s{0,3}\d{1,3}[.)]\s+(.+)$/;

function httpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function inlineParts(source) {
  INLINE.lastIndex = 0;
  const parts = [];
  let last = 0;
  for (const match of source.matchAll(INLINE)) {
    if (match.index > last) parts.push({ type: 'text', value: source.slice(last, match.index) });
    if (match[1]) parts.push({ type: 'strong', children: inlineParts(match[1]) });
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

function hasBlocks(source) {
  if (source.includes('\n\n')) return true;
  return source.split('\n').some(line => HEADING.test(line) || BULLET.test(line) || ORDERED.test(line));
}

function blockParts(source) {
  const lines = source.split('\n');
  const blocks = [];
  let paragraph = [];
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ type: 'paragraph', children: inlineParts(paragraph.join('\n')) });
    paragraph = [];
  };
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === '') {
      flushParagraph();
      index += 1;
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      flushParagraph();
      blocks.push({ type: 'heading', children: inlineParts(heading[1]) });
      index += 1;
      continue;
    }
    const ordered = ORDERED.test(line);
    if (ordered || BULLET.test(line)) {
      flushParagraph();
      const items = [];
      const pattern = ordered ? ORDERED : BULLET;
      while (index < lines.length) {
        const match = lines[index].match(pattern);
        if (!match) break;
        items.push({ type: 'item', children: inlineParts(match[1]) });
        index += 1;
      }
      blocks.push({ type: 'list', ordered, children: items });
      continue;
    }
    paragraph.push(line);
    index += 1;
  }
  flushParagraph();
  return blocks;
}

export function replyMarkdownParts(text) {
  const source = typeof text === 'string' ? text.replace(/\r\n?/g, '\n') : '';
  if (!source || !hasBlocks(source)) return inlineParts(source);
  return blockParts(source);
}

export function replyLinks(text) {
  const collect = parts => parts.flatMap(part => part.type === 'link' ? [part.href] : part.children ? collect(part.children) : []);
  return [...new Set(collect(replyMarkdownParts(text)))];
}

function plainParts(parts) {
  return parts.map(part => {
    if (part.type === 'break') return ' ';
    if (part.type === 'list') return (part.children || []).map(item => plainParts(item.children || [])).join(' ');
    if (part.children) return plainParts(part.children);
    if (part.type === 'link' && part.value === part.href) return '';
    return part.value ?? '';
  }).join('');
}

export function replySpeechText(text) {
  const parts = replyMarkdownParts(text);
  const blocks = parts.some(part => part.type === 'paragraph' || part.type === 'heading' || part.type === 'list');
  const spoken = blocks ? parts.map(part => plainParts([part])).join(' ') : plainParts(parts);
  return spoken.replace(/\*\*/g, '').replace(/\]\(\s*\)/g, '').replace(/\]\(/g, ' ').replace(/[\[\]]/g, '')
    .replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
}
