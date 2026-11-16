import { hostedDevPreview } from './sign-in-gate.mjs';

/** True only when this Worker was given DEV_PREVIEW=1. Local .env.local does not count. */
export async function readHostedDevPreview() {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const ctx = await getCloudflareContext({ async: true });
    return hostedDevPreview(ctx?.env?.DEV_PREVIEW);
  } catch {
    return false;
  }
}
