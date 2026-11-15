/** Live build id. Must not be cached, or an open tab cannot see a push. */
export function GET() {
  const id = typeof process.env.NEXT_PUBLIC_BUILD_ID === 'string' ? process.env.NEXT_PUBLIC_BUILD_ID : '';
  return Response.json(
    { id },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
      },
    },
  );
}
