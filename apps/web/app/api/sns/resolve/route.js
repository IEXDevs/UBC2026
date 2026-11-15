export const runtime = 'nodejs';

import { resolveSnsOwner, SnsError } from '@ubc2026/sns';

export async function GET(request) {
  const domain = new URL(request.url).searchParams.get('domain') || '';
  try {
    const resolved = await resolveSnsOwner(domain);
    return Response.json({
      ok: true,
      domain: resolved.domain,
      address: resolved.address,
      clusterRead: resolved.clusterRead,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const code = error instanceof SnsError ? 'sns_not_found' : 'sns_failed';
    return Response.json({ error: code }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
}
