const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|ogg)$/i;
const CODE_EXT = new Set([
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'cc', 'hpp',
  'cs', 'php', 'json', 'md', 'css', 'html', 'htm', 'xml', 'yml', 'yaml', 'sh', 'bash', 'sql', 'toml',
  'txt', 'vue', 'svelte', 'graphql', 'kt', 'swift', 'lua', 'pl', 'r', 'scala', 'zig', 'ini', 'cfg', 'log',
]);

export const TEXT_PREVIEW_CAP = 200_000;

function extension(name) {
  const clean = typeof name === 'string' ? name.trim().toLowerCase() : '';
  const dot = clean.lastIndexOf('.');
  if (dot < 0 || dot === clean.length - 1) return '';
  return clean.slice(dot + 1);
}

export function stageKind(file) {
  const type = typeof file?.type === 'string' ? file.type.toLowerCase() : '';
  const name = typeof file?.name === 'string' ? file.name : '';
  const ext = extension(name);
  if (type.startsWith('video/') || VIDEO_EXT.test(name)) return 'video';
  if (type.startsWith('audio/') || AUDIO_EXT.test(name)) return 'audio';
  if (type.startsWith('image/') || IMAGE_EXT.test(name)) return 'image';
  if (type === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx') return 'doc';
  if (ext === 'doc' || type === 'application/msword') return 'doc-old';
  if (type.startsWith('text/') || type === 'application/json' || type === 'application/javascript' || type === 'application/xml' || CODE_EXT.has(ext)) return 'code';
  return 'file';
}

export function decodeXml(value) {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, digits) => String.fromCodePoint(Number(digits)))
    .replace(/&amp;/g, '&');
}

export function docxParagraphsFromXml(xml) {
  const paragraphs = [];
  for (const chunk of String(xml).split(/<\/w:p>/i)) {
    const texts = [...chunk.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/gi)].map(match => decodeXml(match[1]));
    const line = texts.join('').replace(/\s+\n/g, '\n').trim();
    if (line) paragraphs.push(line.slice(0, 2000));
    if (paragraphs.length >= 400) break;
  }
  return paragraphs;
}

async function inflate(slice) {
  const stream = new Blob([slice]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function unzipEntry(bytes, name) {
  const data = bytes instanceof Uint8Array ? new Uint8Array(bytes) : new Uint8Array(bytes);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;
  while (offset + 30 <= data.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const compSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLen + extraLen;
    const entryName = new TextDecoder().decode(data.subarray(nameStart, nameStart + nameLen));
    const slice = data.subarray(dataStart, dataStart + compSize);
    if (entryName === name) {
      if (method === 0) return slice;
      if (method === 8) return inflate(slice);
      return null;
    }
    offset = dataStart + compSize;
  }
  return null;
}

export async function readPreview(url, kind, fetcher = fetch) {
  const response = await fetcher(url);
  if (!response?.ok) return { error: 'empty' };
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (kind === 'code') {
    if (bytes.byteLength > TEXT_PREVIEW_CAP) return { error: 'long' };
    if (bytes.includes(0)) return { error: 'binary' };
    return { text: new TextDecoder().decode(bytes) };
  }
  if (kind === 'doc') {
    const xmlBytes = await unzipEntry(bytes, 'word/document.xml');
    if (!xmlBytes) return { error: 'doc' };
    const paragraphs = docxParagraphsFromXml(new TextDecoder().decode(xmlBytes));
    if (paragraphs.length === 0) return { error: 'doc' };
    return { paragraphs };
  }
  return { error: 'empty' };
}
