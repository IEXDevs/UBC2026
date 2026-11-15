const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MEDIA = /\.(png|jpe?g|gif|webp|mp4|mov|webm|mp3|wav|m4a)$/i;
const PAGE = /\.(html?|url)$/i;

export function fileKind(file) {
  const type = typeof file?.type === 'string' ? file.type : '';
  const name = typeof file?.name === 'string' ? file.name : '';
  if (type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/') || MEDIA.test(name)) return 'media';
  if (type === 'text/html' || PAGE.test(name)) return 'pages';
  return 'files';
}

export function filterLibrary(files, kind = 'all') {
  const rows = Array.isArray(files) ? files : [];
  if (kind === 'all') return rows;
  return rows.filter(file => fileKind(file) === kind);
}

export function libraryGroups(files, now = Date.now()) {
  const fresh = [];
  const older = [];
  for (const file of Array.isArray(files) ? files : []) {
    const at = Number.isFinite(file?.addedAt) ? file.addedAt : now;
    if (now - at < WEEK_MS) fresh.push(file);
    else older.push(file);
  }
  return { fresh, older };
}
