const portfolios = new Map();

export function cachedPortfolio(key) {
  if (typeof key !== 'string' || !key) return null;
  return portfolios.get(key) ?? null;
}

export function rememberPortfolio(key, portfolio) {
  if (typeof key !== 'string' || !key || !portfolio || typeof portfolio !== 'object') return;
  portfolios.set(key, portfolio);
}

export function clearPortfolioCache(key) {
  if (typeof key === 'string' && key) {
    portfolios.delete(key);
    return;
  }
  portfolios.clear();
}
