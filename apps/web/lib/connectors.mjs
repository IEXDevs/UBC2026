const STORE_KEY = 'maelstrom.sharedConnectors';

export function withSharedLinks(connectors, extraIds) {
  const extra = new Set(extraIds);
  return connectors.map(item => ({
    ...item,
    linked: Boolean(item.builtin) || extra.has(item.id),
  }));
}

export function readSharedLinks() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function writeSharedLinks(ids) {
  localStorage.setItem(STORE_KEY, JSON.stringify([...new Set(ids)]));
}

export function groupConnectors(rows, query) {
  const q = query.trim().toLowerCase();
  const matched = q
    ? rows.filter(row => `${row.name} ${row.detail} ${row.category ?? ''}`.toLowerCase().includes(q))
    : rows;
  const linked = matched.filter(row => row.linked);
  const open = matched.filter(row => !row.linked);
  return {
    linked,
    available: q ? open : open.filter(row => row.popular),
  };
}
