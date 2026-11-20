/** Per-owner file cap. Oldest files are dropped so a new upload can still land. */
export const USER_STORAGE_CAP = 5_000_000_000;
export const PROJECT_STORAGE_CAP = 1_000_000_000_000;
export const FILE_BYTE_CAP = 512_000_000;

export const STORAGE_CAP_WARNING = "You've reached 5 GB. This upload will continue. Older files will be removed to stay under 5 GB.";

export const STORAGE_FILE_TOO_BIG = 'That file is larger than 5 GB, so it was not saved.';

function rowsOf(library) {
  const rows = [];
  for (const [botId, files] of Object.entries(library || {})) {
    if (!Array.isArray(files)) continue;
    for (const file of files) {
      if (!file || typeof file.id !== 'string') continue;
      const size = Number(file.size);
      rows.push({
        botId,
        file,
        size: Number.isFinite(size) && size > 0 ? size : 0,
        addedAt: Number(file.addedAt) || 0,
      });
    }
  }
  return rows;
}

/**
 * Keep the newest files whose sizes sum to the cap.
 * A file larger than the cap is rejected and does not cause other files to be deleted.
 */
export function enforceStorageCap(library, cap = USER_STORAGE_CAP, preferIds = null) {
  const prefer = preferIds instanceof Set ? preferIds : new Set();
  const rows = rowsOf(library);
  const rejected = [];
  const candidates = [];
  for (const row of rows) {
    if (row.size > cap) rejected.push(row);
    else candidates.push(row);
  }
  candidates.sort((a, b) => {
    const time = b.addedAt - a.addedAt;
    if (time) return time;
    return (prefer.has(a.file.id) ? 0 : 1) - (prefer.has(b.file.id) ? 0 : 1);
  });
  const kept = [];
  const removed = [];
  let used = 0;
  for (const row of candidates) {
    if (used + row.size <= cap) {
      kept.push(row);
      used += row.size;
    } else {
      removed.push(row);
    }
  }
  const next = {};
  for (const row of kept) {
    const list = next[row.botId] || [];
    list.push(row.file);
    next[row.botId] = list;
  }
  for (const botId of Object.keys(next)) {
    next[botId].sort((a, b) => (Number(b.addedAt) || 0) - (Number(a.addedAt) || 0));
  }
  return {
    library: next,
    removed: removed.map(row => row.file),
    rejected: rejected.map(row => row.file),
    used,
  };
}
