export const runtime = 'nodejs';

/**
 * Token pages call DexScreener from the browser.
 * This route does not proxy that API: one worker IP would share the rate limit.
 */
export async function GET() {
  return Response.json(
    { error: 'browser_dex', quoteSource: 'dexscreener' },
    { status: 400, headers: { 'Cache-Control': 'no-store' } },
  );
}
