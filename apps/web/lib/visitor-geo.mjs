/**
 * Visitor geo from the request that hit this Worker.
 * Local next dev has none. The voice worker must not use this: that request comes from ElevenLabs.
 */

export async function visitorGeo(request) {
  const direct = request?.cf;
  if (direct && typeof direct === 'object' && (direct.city || direct.region || direct.timezone)) {
    return direct;
  }
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const ctx = await getCloudflareContext({ async: true });
    const cf = ctx?.cf;
    if (cf && typeof cf === 'object' && (cf.city || cf.region || cf.timezone)) return cf;
  } catch {
    /* next dev has no Worker request geo. */
  }
  return {};
}
