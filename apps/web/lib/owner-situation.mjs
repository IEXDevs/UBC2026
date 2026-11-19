/**
 * Clock and place the desk sends with chat and voice.
 * The server checks the zone and the place again. This only keeps the fields small.
 */

export function browserSituation() {
  try {
    const opts = Intl.DateTimeFormat().resolvedOptions();
    const timeZone = typeof opts?.timeZone === 'string' ? opts.timeZone.trim() : '';
    const locale = typeof opts?.locale === 'string' ? opts.locale.trim() : '';
    return {
      ...(timeZone ? { timeZone: timeZone.slice(0, 64) } : {}),
      ...(locale ? { locale: locale.slice(0, 35) } : {}),
    };
  } catch {
    return {};
  }
}

/** Browser zone wins. Edge place fills in when the browser has no city. */
export function mergeOwnerSituation(local, edge) {
  const clock = local && typeof local === 'object' ? local : {};
  const geo = edge && typeof edge === 'object' ? edge : {};
  const timeZone = (typeof clock.timeZone === 'string' ? clock.timeZone.trim() : '')
    || (typeof geo.timeZone === 'string' ? geo.timeZone.trim() : '');
  const place = (typeof clock.place === 'string' ? clock.place.trim() : '')
    || (typeof geo.place === 'string' ? geo.place.trim() : '');
  const locale = typeof clock.locale === 'string' ? clock.locale.trim() : '';
  return {
    ...(timeZone ? { timeZone: timeZone.slice(0, 64) } : {}),
    ...(place ? { place: place.slice(0, 80) } : {}),
    ...(locale ? { locale: locale.slice(0, 35) } : {}),
  };
}

export function situationBody(value) {
  const merged = mergeOwnerSituation(value, null);
  return Object.keys(merged).length > 0 ? merged : null;
}
