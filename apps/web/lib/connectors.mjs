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
    ? rows.filter(row => haystack(row).includes(q))
    : rows;
  const linked = matched.filter(row => row.linked);
  const open = matched.filter(row => !row.linked);
  return {
    linked,
    available: q ? open : open.filter(row => row.popular),
  };
}

export const PLUGIN_CHIPS = Object.freeze([
  { id: 'all', label: 'All' },
  { id: 'chain', label: 'Chain', categories: Object.freeze(['Chain']) },
  { id: 'research', label: 'Research', categories: Object.freeze(['Research']) },
  { id: 'code', label: 'Code', categories: Object.freeze(['Code']) },
  { id: 'communication', label: 'Communication', categories: Object.freeze(['Mail', 'Chat']) },
  { id: 'productivity', label: 'Productivity', categories: Object.freeze(['Docs', 'Calendar', 'Work']) },
  { id: 'commerce', label: 'Commerce', categories: Object.freeze(['Payments', 'Commerce']) },
  { id: 'more', label: 'More', categories: Object.freeze(['Identity', 'Social', 'Design']) },
]);

const BUILTIN_SECTIONS = Object.freeze([
  { id: 'chain', title: 'Chain', categories: ['Chain'] },
  { id: 'research', title: 'Research', categories: ['Research'] },
  { id: 'identity', title: 'Identity', categories: ['Identity'] },
  { id: 'payments', title: 'Payments', categories: ['Payments'] },
]);

function haystack(row) {
  return `${row.name} ${row.detail} ${row.category ?? ''} ${row.id ?? ''}`.toLowerCase();
}

function matchesQuery(row, query) {
  if (!query) return true;
  return haystack(row).includes(query);
}

/**
 * Ordered plugin catalog. The default view leads with apps the owner can
 * connect, then the built-in apps already on. A search, chip, or connected
 * filter collapses that into one list.
 */
export function pluginCatalog(rows, {
  query = '',
  chip = 'all',
  connectedOnly = false,
  recommendedLimit = 8,
  showAllRecommended = false,
} = {}) {
  const q = query.trim().toLowerCase();
  const spec = PLUGIN_CHIPS.find(item => item.id === chip) ?? PLUGIN_CHIPS[0];
  const categories = spec.categories ? new Set(spec.categories) : null;
  const matched = rows.filter(row => {
    if (connectedOnly && !row.linked) return false;
    if (categories && !categories.has(row.category)) return false;
    return matchesQuery(row, q);
  });
  if (q || chip !== 'all' || connectedOnly) {
    return matched.length
      ? [{ id: 'matches', title: null, items: matched, total: matched.length, canExpand: false }]
      : [];
  }
  const recommended = matched.filter(row => !row.builtin && !row.custom);
  const shown = showAllRecommended ? recommended : recommended.slice(0, recommendedLimit);
  const sections = [];
  const yours = matched.filter(row => row.custom);
  if (yours.length) {
    sections.push({ id: 'yours', title: 'Your providers', items: yours, total: yours.length, canExpand: false });
  }
  if (shown.length) {
    sections.push({
      id: 'recommended',
      title: 'Recommended for you',
      items: shown,
      total: recommended.length,
      canExpand: recommended.length > shown.length,
    });
  }
  for (const group of BUILTIN_SECTIONS) {
    const items = matched.filter(row => row.builtin && group.categories.includes(row.category));
    if (items.length) {
      sections.push({ id: group.id, title: group.title, items, total: items.length, canExpand: false });
    }
  }
  return sections;
}
